import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import type { ControlPlaneDiagnostic, LoginDiagnosticCode } from '@uapkg/diagnostics';
import isCI from 'is-ci';
import * as oauth from 'oauth4webapi';
import { AuthMetadataStore } from './AuthMetadataStore.js';
import { ControlPlaneClient, type ControlPlaneCredential } from './ControlPlaneClient.js';
import {
  ControlPlaneError,
  type RegistryGrantMetadata,
  type RegistryTrust,
  registryAudience,
  UAPKG_AUTHORIZATION_ISSUER,
  UAPKG_CLI_CLIENT_ID,
  UAPKG_CLI_SCOPES,
  UAPKG_CONTROL_PLANE_API,
  type UAPKGCliScope,
} from './ControlPlaneTypes.js';
import { CredentialStore } from './CredentialStore.js';
import { DPoPKeyStore } from './DPoPKeyStore.js';
import { FileRegistryGrantLock, type RegistryGrantLock } from './RegistryGrantLock.js';

const INTERACTIVE_LOGIN_TIMEOUT_MS = 3 * 60 * 1000;
const INTERACTIVE_LOGIN_FINALIZATION_TIMEOUT_MS = 60 * 1000;
const OAUTH_BACKCHANNEL_TIMEOUT_MS = 30 * 1000;
const LOOPBACK_CALLBACK_PATH = '/callback';
const ACCOUNT_COMPLETION_PATH = '/cli-login/complete';
const ALLOWED_CLI_SCOPES = new Set<string>(UAPKG_CLI_SCOPES);

export interface LoginOptions {
  readonly deviceName?: string;
  readonly reauthorize?: boolean;
  readonly onProgress?: (event: LoginProgressEvent) => void;
}

export type LoginProgressEvent =
  | { readonly type: 'preparing'; readonly registryAlias: string }
  | { readonly type: 'opening-browser' }
  | { readonly type: 'browser-open-failed'; readonly authorizationUrl: string }
  | { readonly type: 'waiting-for-decision' }
  | { readonly type: 'approval-received' };

type LoginCompletionOutcome = 'success' | 'denied' | 'failed';

export class LoginError extends Error {
  public constructor(
    public readonly code: LoginDiagnosticCode,
    message: string,
    public readonly oauthError?: string,
  ) {
    super(message);
    this.name = 'LoginError';
  }
}

export interface LoginResult {
  readonly grant: RegistryGrantMetadata;
  readonly warnings: readonly string[];
}

export interface AccessCredential {
  readonly credential: ControlPlaneCredential;
  readonly grant: RegistryGrantMetadata;
}

export type BrowserOpener = (url: string) => Promise<void>;

export class AccountManager {
  private readonly keyStore: DPoPKeyStore;
  private readonly accessTokenCache = new Map<
    string,
    { readonly token: string; readonly expiresAt: number; readonly dpop: oauth.DPoPHandle }
  >();
  private readonly grantOperationTails = new Map<string, Promise<void>>();
  private readonly grantLock: RegistryGrantLock;

  public constructor(
    private readonly metadata = new AuthMetadataStore(),
    private readonly credentials = new CredentialStore(),
    private readonly openBrowser: BrowserOpener = async (url) => {
      const { default: open } = await import('open');
      await open(url, { wait: false });
    },
    private readonly isInteractiveLogin = () => Boolean(process.stdin.isTTY && process.stdout.isTTY && !isCI),
    grantLock?: RegistryGrantLock,
    private readonly interactiveLoginTimeoutMs = INTERACTIVE_LOGIN_TIMEOUT_MS,
    private readonly interactiveLoginFinalizationTimeoutMs = INTERACTIVE_LOGIN_FINALIZATION_TIMEOUT_MS,
  ) {
    this.keyStore = new DPoPKeyStore(credentials);
    const metadataPath = typeof metadata.path === 'string' ? metadata.path : join(homedir(), '.uapkg', 'auth.json');
    this.grantLock = grantLock ?? new FileRegistryGrantLock(join(dirname(metadataPath), 'auth-locks'));
  }

  public async hasGrant(trust: RegistryTrust): Promise<boolean> {
    return Boolean(await this.metadata.find(trust.issuer, trust.registryId));
  }

  public invalidateAccessCredentials(trust: RegistryTrust): void {
    for (const key of this.accessTokenCache.keys()) {
      if (key.startsWith(`${trust.issuer}|${trust.registryId}|`)) {
        this.accessTokenCache.delete(key);
      }
    }
  }

  public async login(trust: RegistryTrust, options: LoginOptions = {}): Promise<LoginResult> {
    this.assertPinnedTrust(trust);
    this.assertInteractiveLogin();
    await this.credentials.assertAvailable();

    const previous = await this.metadata.find(trust.issuer, trust.registryId);
    if (previous && !options.reauthorize) {
      throw new Error(
        `This device already has a saved login for "${trust.alias}". Use \`uapkg login --registry ${trust.alias} --reauthorize\` to replace it.`,
      );
    }

    emitLoginProgress(options.onProgress, { type: 'preparing', registryAlias: trust.alias });
    const issuer = new URL(trust.issuer);
    const as = await this.discover(issuer);
    this.validateAuthorizationServer(as);
    const client = this.client();
    const keyPair = await this.keyStore.generate();
    const dpop = oauth.DPoP(client, keyPair);
    const publicKeyThumbprint = await dpop.calculateThumbprint();
    const receiver = await LoopbackAuthorizationReceiver.listen(issuer);
    let issuedRefreshToken: string | undefined;
    let retainedIssuedGrant = false;
    let callbackReceipt: LoopbackAuthorizationReceipt | undefined;
    let finalizationController: AbortController | undefined;
    let finalizationTimeout: NodeJS.Timeout | undefined;

    try {
      const codeVerifier = oauth.generateRandomCodeVerifier();
      const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
      const state = oauth.generateRandomState();
      const nonce = oauth.generateRandomNonce();
      const scope = ['openid', 'offline_access', ...UAPKG_CLI_SCOPES].join(' ');
      const deviceName = normalizeDeviceName(options.deviceName);

      const parameters = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: receiver.redirectUri,
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
        nonce,
        scope,
        resource: trust.resource,
        dpop_jkt: publicKeyThumbprint,
        registry_id: trust.registryId,
        registry_source_fingerprint: trust.repositoryFingerprint,
        device_name: deviceName,
        max_age: '300',
      });

      const pushed = await this.withDPoPNonceRetry(
        () =>
          oauth.pushedAuthorizationRequest(as, client, oauth.None(), parameters, {
            DPoP: dpop,
            signal: () => AbortSignal.timeout(OAUTH_BACKCHANNEL_TIMEOUT_MS),
          }),
        (response) => oauth.processPushedAuthorizationResponse(as, client, response),
      );

      if (!as.authorization_endpoint) {
        throw new Error('The authorization server did not advertise an authorization endpoint.');
      }
      const authorizationUrl = new URL(as.authorization_endpoint);
      authorizationUrl.searchParams.set('client_id', client.client_id);
      authorizationUrl.searchParams.set('request_uri', pushed.request_uri);

      emitLoginProgress(options.onProgress, { type: 'opening-browser' });
      try {
        await this.openBrowser(authorizationUrl.href);
      } catch {
        emitLoginProgress(options.onProgress, {
          type: 'browser-open-failed',
          authorizationUrl: authorizationUrl.href,
        });
      }
      emitLoginProgress(options.onProgress, { type: 'waiting-for-decision' });
      callbackReceipt = await receiver.waitForCallback(this.interactiveLoginTimeoutMs, trust.alias);
      finalizationController = new AbortController();
      finalizationTimeout = setTimeout(() => {
        finalizationController?.abort(loginFinalizationTimeoutError(trust.alias));
      }, this.interactiveLoginFinalizationTimeoutMs);
      const finalizationSignal = finalizationController.signal;
      const callbackUrl = callbackReceipt.url;
      if (callbackUrl.searchParams.get('iss') !== trust.issuer) {
        throw new LoginError(
          'LOGIN_AUTHORIZATION_RESPONSE_INVALID',
          'The browser authorization response came from an unexpected issuer. Run `uapkg login` again.',
        );
      }

      let callbackParameters: URLSearchParams;
      try {
        callbackParameters = oauth.validateAuthResponse(as, client, callbackUrl, state);
      } catch (error) {
        throw authorizationResponseLoginError(error);
      }
      emitLoginProgress(options.onProgress, { type: 'approval-received' });
      const tokens = await this.withDPoPNonceRetry(
        () =>
          oauth.authorizationCodeGrantRequest(
            as,
            client,
            oauth.None(),
            callbackParameters,
            receiver.redirectUri,
            codeVerifier,
            { DPoP: dpop, signal: finalizationSignal },
          ),
        (response) =>
          oauth.processAuthorizationCodeResponse(as, client, response, {
            expectedNonce: nonce,
            maxAge: 300,
            requireIdToken: true,
          }),
      );
      finalizationSignal.throwIfAborted();

      if (tokens.token_type !== 'dpop') {
        throw new Error('The authorization server did not issue a DPoP-bound access token.');
      }
      if (!tokens.refresh_token) {
        throw new Error('The authorization server did not issue a persistent registry grant.');
      }
      const refreshToken = tokens.refresh_token;
      issuedRefreshToken = refreshToken;

      const self = await new ControlPlaneClient(trust.apiBaseUrl).getSelf(
        {
          kind: 'dpop',
          accessToken: tokens.access_token,
          dpop,
        },
        finalizationSignal,
      );
      finalizationSignal.throwIfAborted();
      if (self.registry.id !== trust.registryId) {
        throw new Error('The authorization server returned a registry grant for an unexpected registry.');
      }
      const missingScopes = UAPKG_CLI_SCOPES.filter((scope) => !self.grant.scopes.includes(scope));
      if (missingScopes.length > 0) {
        throw new Error(`The authorization server omitted required CLI capabilities: ${missingScopes.join(', ')}.`);
      }
      const grantId = self.grant.id;
      const keyReference = this.credentials.createReference('dpop-key', trust.issuer, trust.registryId, grantId);
      const refreshTokenReference = this.credentials.createReference('grant', trust.issuer, trust.registryId, grantId);
      const metadata: RegistryGrantMetadata = {
        issuer: trust.issuer,
        registryId: trust.registryId,
        registryName: trust.registryName,
        grantId,
        clientId: client.client_id,
        keyReference,
        refreshTokenReference,
        publicKeyThumbprint,
        deviceName: self.grant.deviceName,
        repositoryFingerprint: trust.repositoryFingerprint,
        account: self.account,
        createdAt: Math.floor(Date.now() / 1000),
        idleExpiresAt: timestampFromIso(self.grant.idleExpiresAt),
        expiresAt: timestampFromIso(self.grant.absoluteExpiresAt),
      };

      const warnings = await this.serializeGrantOperation(trust, async () => {
        const currentPrevious = await this.metadata.find(trust.issuer, trust.registryId);
        if (currentPrevious && !options.reauthorize) {
          throw new Error(
            `This device already has a saved login for "${trust.alias}". Use \`uapkg login --registry ${trust.alias} --reauthorize\` to replace it.`,
          );
        }
        return this.persistIssuedGrant(metadata, keyPair, refreshToken, currentPrevious, finalizationSignal, () => {
          retainedIssuedGrant = true;
          if (finalizationTimeout) {
            clearTimeout(finalizationTimeout);
            finalizationTimeout = undefined;
          }
        });
      });
      await callbackReceipt.complete('success');
      return { grant: metadata, warnings };
    } catch (error) {
      if (finalizationTimeout) {
        clearTimeout(finalizationTimeout);
        finalizationTimeout = undefined;
      }
      const failure =
        error instanceof LoginError
          ? error
          : finalizationController?.signal.aborted && finalizationController.signal.reason instanceof LoginError
            ? finalizationController.signal.reason
            : error;
      if (issuedRefreshToken && !retainedIssuedGrant) {
        await this.revokeToken(as, client, issuedRefreshToken, dpop).catch(() => undefined);
      }
      const loginError = normalizeLoginError(failure);
      if (callbackReceipt) {
        const outcome = loginError.code === 'LOGIN_ACCESS_DENIED' ? 'denied' : 'failed';
        await callbackReceipt.complete(outcome).catch(() => undefined);
      }
      throw loginError;
    } finally {
      if (finalizationTimeout) clearTimeout(finalizationTimeout);
      receiver.close();
    }
  }

  public async getAccessCredential(trust: RegistryTrust, scopes: readonly UAPKGCliScope[]): Promise<AccessCredential> {
    this.assertPinnedTrust(trust);
    const requestedScopes = [...new Set(scopes)].sort();
    if (requestedScopes.length === 0 || requestedScopes.some((scope) => !ALLOWED_CLI_SCOPES.has(scope))) {
      throw new Error('A control-plane operation requested an unsupported OAuth capability scope.');
    }
    const grant = await this.requireUsableGrant(trust);
    const cacheKey = this.accessTokenCacheKey(grant, requestedScopes);
    const cached = this.accessTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 15_000) {
      return {
        grant,
        credential: { kind: 'dpop', accessToken: cached.token, dpop: cached.dpop },
      };
    }

    return this.serializeGrantOperation(trust, async () => {
      // Another process may have replaced the grant or rotated its refresh
      // token while this process waited. Reload every persistent component
      // only after the cross-process lock has been acquired.
      const currentGrant = await this.requireUsableGrant(trust);
      const currentCacheKey = this.accessTokenCacheKey(currentGrant, requestedScopes);
      const refreshedCached = this.accessTokenCache.get(currentCacheKey);
      if (refreshedCached && refreshedCached.expiresAt > Date.now() + 15_000) {
        return {
          grant: currentGrant,
          credential: {
            kind: 'dpop',
            accessToken: refreshedCached.token,
            dpop: refreshedCached.dpop,
          },
        };
      }

      const pair = await this.keyStore.load(currentGrant.keyReference);
      if (!pair) throw missingKeyError(trust);
      const client = this.client();
      const dpop = oauth.DPoP(client, pair);
      if ((await dpop.calculateThumbprint()) !== currentGrant.publicKeyThumbprint) {
        throw missingKeyError(trust);
      }

      // Refresh tokens rotate on every successful use. Read the current value
      // only after acquiring both the process-local and filesystem lock.
      const refreshToken = await this.credentials.get(currentGrant.refreshTokenReference);
      if (!refreshToken) {
        throw new Error(
          `The saved login for "${trust.alias}" is missing its protected registry grant. Run \`uapkg login --registry ${trust.alias}\` again.`,
        );
      }
      const as = await this.discover(new URL(trust.issuer));
      let tokenResponse: oauth.TokenEndpointResponse;
      try {
        tokenResponse = await this.withDPoPNonceRetry(
          () =>
            oauth.refreshTokenGrantRequest(as, client, oauth.None(), refreshToken, {
              DPoP: dpop,
              additionalParameters: {
                resource: trust.resource,
                scope: requestedScopes.join(' '),
              },
            }),
          (response) => oauth.processRefreshTokenResponse(as, client, response),
        );
      } catch (error) {
        if (
          error instanceof oauth.ResponseBodyError &&
          (error.error === 'invalid_grant' || error.error === 'invalid_token')
        ) {
          throw new Error(
            `Your saved login for "${trust.alias}" is no longer valid. Run \`uapkg login --registry ${trust.alias} --reauthorize\` to authenticate again.`,
            { cause: error },
          );
        }
        throw error;
      }
      if (tokenResponse.token_type !== 'dpop') {
        throw new Error('The authorization server returned an access token that is not DPoP-bound.');
      }
      if (tokenResponse.refresh_token && tokenResponse.refresh_token !== refreshToken) {
        await this.credentials.set(currentGrant.refreshTokenReference, tokenResponse.refresh_token);
      }

      const expiresAt = Date.now() + Math.max(1, tokenResponse.expires_in ?? 300) * 1000;
      this.accessTokenCache.set(currentCacheKey, { token: tokenResponse.access_token, expiresAt, dpop });
      return {
        grant: currentGrant,
        credential: { kind: 'dpop', accessToken: tokenResponse.access_token, dpop },
      };
    });
  }

  public async logout(trust: RegistryTrust, localOnly = false): Promise<'not-logged-in' | 'removed'> {
    this.assertPinnedTrust(trust);
    return this.serializeGrantOperation(trust, async () => {
      const grant = await this.metadata.find(trust.issuer, trust.registryId);
      if (!grant) return 'not-logged-in';

      if (!localOnly) {
        try {
          await this.revokeSavedGrant(grant);
        } catch (error) {
          throw new Error(
            `Unable to revoke the registry grant for "${trust.alias}". The local login was kept so you can retry. Use --local-only only if you accept that account-site revocation may still be required.`,
            { cause: error },
          );
        }
      }
      await Promise.all([
        this.keyStore.delete(grant.keyReference),
        this.credentials.delete(grant.refreshTokenReference),
      ]);
      await this.metadata.remove(grant.issuer, grant.registryId);
      this.invalidateAccessCredentials(trust);
      return 'removed';
    });
  }

  private async requireUsableGrant(trust: RegistryTrust): Promise<RegistryGrantMetadata> {
    const grant = await this.metadata.find(trust.issuer, trust.registryId);
    if (!grant) {
      throw new Error(`You are not logged in to "${trust.alias}". Run \`uapkg login --registry ${trust.alias}\`.`);
    }
    if (grant.repositoryFingerprint !== trust.repositoryFingerprint) {
      throw new Error(
        `The configured Git source for "${trust.alias}" does not match the source authorized by the saved login. Run \`uapkg login --registry ${trust.alias} --reauthorize\`.`,
      );
    }
    const now = Math.floor(Date.now() / 1000);
    // The idle deadline advances whenever the grant is used. The saved value
    // is display metadata from login time, so the server remains authoritative
    // for idle expiry; the absolute deadline is stable and safe to reject
    // locally.
    if (grant.expiresAt && grant.expiresAt <= now) {
      throw new Error(
        `Your saved login for "${trust.alias}" has expired. Run \`uapkg login --registry ${trust.alias}\` again.`,
      );
    }
    return grant;
  }

  private async revokeSavedGrant(grant: RegistryGrantMetadata): Promise<void> {
    const refreshToken = await this.credentials.get(grant.refreshTokenReference);
    if (!refreshToken) {
      throw new Error('The registry grant cannot be revoked because its protected credential is missing.');
    }
    const pair = await this.keyStore.load(grant.keyReference);
    if (!pair) throw new Error('The registry grant cannot be revoked because its DPoP key is missing.');
    const dpop = oauth.DPoP(this.client(), pair);
    if ((await dpop.calculateThumbprint()) !== grant.publicKeyThumbprint) {
      throw new Error('The registry grant cannot be revoked because its DPoP key has changed.');
    }
    const as = await this.discover(new URL(grant.issuer));
    await this.revokeToken(as, this.client(), refreshToken, dpop);
  }

  private async persistIssuedGrant(
    metadata: RegistryGrantMetadata,
    keyPair: oauth.CryptoKeyPair,
    refreshToken: string,
    previous?: RegistryGrantMetadata,
    signal?: AbortSignal,
    onPersisted?: () => void,
  ): Promise<readonly string[]> {
    let metadataWriteAttempted = false;
    try {
      signal?.throwIfAborted();
      await this.keyStore.save(metadata.keyReference, keyPair);
      signal?.throwIfAborted();
      await this.credentials.set(metadata.refreshTokenReference, refreshToken);
      signal?.throwIfAborted();
      metadataWriteAttempted = true;
      await this.metadata.upsert(metadata);
      signal?.throwIfAborted();
      onPersisted?.();
    } catch (error) {
      const cleanup: Promise<unknown>[] = [
        this.keyStore.delete(metadata.keyReference),
        this.credentials.delete(metadata.refreshTokenReference),
      ];
      let metadataRollbackIndex: number | undefined;
      if (metadataWriteAttempted) {
        metadataRollbackIndex = cleanup.length;
        cleanup.push(
          previous ? this.metadata.upsert(previous) : this.metadata.remove(metadata.issuer, metadata.registryId),
        );
      }
      const cleanupResults = await Promise.allSettled(cleanup);
      if (metadataRollbackIndex !== undefined && cleanupResults[metadataRollbackIndex]?.status === 'rejected') {
        throw new LoginError(
          'LOGIN_FAILED',
          'Login failed, and UAPKG could not roll back the local login metadata safely. Check `uapkg whoami --json` before retrying.',
        );
      }
      throw error;
    }

    if (!previous) return [];
    if (
      previous.grantId === metadata.grantId ||
      (previous.keyReference === metadata.keyReference &&
        previous.refreshTokenReference === metadata.refreshTokenReference)
    ) {
      return [];
    }

    const warnings: string[] = [];
    try {
      await this.revokeSavedGrant(previous);
    } catch {
      warnings.push(
        `The previous registry grant could not be revoked from this device. The new login is active, but you should revoke the inaccessible old grant from the UAPKG account website.`,
      );
    }
    const cleanupResults = await Promise.allSettled([
      this.keyStore.delete(previous.keyReference),
      this.credentials.delete(previous.refreshTokenReference),
    ]);
    if (cleanupResults.some(({ status }) => status === 'rejected')) {
      warnings.push(
        'The previous registry grant was replaced, but one or more old protected credential entries could not be removed. Remove the stale UAPKG entries from the operating-system credential store.',
      );
    }
    return warnings;
  }

  private async revokeToken(
    as: oauth.AuthorizationServer,
    client: oauth.Client,
    refreshToken: string,
    dpop: oauth.DPoPHandle,
  ): Promise<void> {
    const signer = signingDPoPHandle(dpop);
    await this.withDPoPNonceRetry(
      () =>
        oauth.revocationRequest(as, client, oauth.None(), refreshToken, {
          additionalParameters: { token_type_hint: 'refresh_token' },
          signal: AbortSignal.timeout(OAUTH_BACKCHANNEL_TIMEOUT_MS),
          [oauth.customFetch]: async (url, options) => {
            const endpoint = new URL(url);
            const headers = new Headers(options.headers);
            await signer.addProof(endpoint, headers, 'POST');
            const response = await fetch(url, { ...options, headers });
            signer.cacheNonce(response, endpoint);
            return response;
          },
        }),
      (response) => oauth.processRevocationResponse(response),
    );
  }

  private async discover(issuer: URL): Promise<oauth.AuthorizationServer> {
    const discoveryUrl = oidcDiscoveryUrl(issuer);
    let response: Response;
    try {
      response = await oauth.discoveryRequest(issuer, {
        algorithm: 'oidc',
        signal: AbortSignal.timeout(OAUTH_BACKCHANNEL_TIMEOUT_MS),
      });
    } catch {
      throw new Error(
        `Unable to retrieve OAuth metadata for build-pinned issuer "${issuer.href}" from discovery URL "${discoveryUrl.href}".`,
      );
    }

    try {
      return await oauth.processDiscoveryResponse(issuer, response);
    } catch {
      throw new Error(
        `Invalid OAuth metadata for build-pinned issuer "${issuer.href}" from discovery URL "${discoveryUrl.href}" (HTTP ${response.status}).`,
      );
    }
  }

  private validateAuthorizationServer(as: oauth.AuthorizationServer): void {
    if (!as.authorization_endpoint || !as.token_endpoint || !as.pushed_authorization_request_endpoint) {
      throw new Error('The UAPKG authorization server is missing required authorization, token, or PAR endpoints.');
    }
    if (!as.revocation_endpoint) {
      throw new Error('The UAPKG authorization server is missing its grant revocation endpoint.');
    }
    if (as.code_challenge_methods_supported && !as.code_challenge_methods_supported.includes('S256')) {
      throw new Error('The UAPKG authorization server does not support PKCE S256.');
    }
    if (as.dpop_signing_alg_values_supported && !as.dpop_signing_alg_values_supported.includes('ES256')) {
      throw new Error('The UAPKG authorization server does not support ES256 DPoP proofs.');
    }
  }

  private client(): oauth.Client {
    return {
      client_id: UAPKG_CLI_CLIENT_ID,
      token_endpoint_auth_method: 'none',
    };
  }

  private assertPinnedTrust(trust: RegistryTrust): void {
    if (
      trust.issuer !== UAPKG_AUTHORIZATION_ISSUER ||
      trust.apiBaseUrl !== UAPKG_CONTROL_PLANE_API ||
      trust.resource !== registryAudience(trust.registryId)
    ) {
      throw new Error('UAPKG v1 does not accept project-configured authorization issuers or API URLs.');
    }
  }

  private assertInteractiveLogin(): void {
    if (this.isInteractiveLogin()) return;
    throw new Error(
      [
        'Unable to complete interactive login on this machine.',
        '',
        'Persistent login is not supported in headless environments.',
        '',
        'For automated publishing, configure a GitHub Actions OIDC trusted publisher.',
        'For interactive publishing, run `uapkg login` from a trusted, browser-capable workstation.',
      ].join('\n'),
    );
  }

  private async withDPoPNonceRetry<T>(
    request: () => Promise<Response>,
    processResponse: (response: Response) => Promise<T>,
  ): Promise<T> {
    try {
      return await processResponse(await request());
    } catch (error) {
      if (!oauth.isDPoPNonceError(error)) throw error;
      return processResponse(await request());
    }
  }

  private accessTokenCacheKey(grant: RegistryGrantMetadata, scopes: readonly UAPKGCliScope[]): string {
    return `${grant.issuer}|${grant.registryId}|${grant.grantId}|${scopes.join(' ')}`;
  }

  private async serializeGrantOperation<T>(trust: RegistryTrust, operation: () => Promise<T>): Promise<T> {
    const key = `${trust.issuer}|${trust.registryId}`;
    const previous = this.grantOperationTails.get(key) ?? Promise.resolve();
    const result = previous.then(() => this.grantLock.withLock(trust.issuer, trust.registryId, operation));
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.grantOperationTails.set(key, tail);

    try {
      return await result;
    } finally {
      if (this.grantOperationTails.get(key) === tail) {
        this.grantOperationTails.delete(key);
      }
    }
  }
}

interface SigningDPoPHandle extends oauth.DPoPHandle {
  addProof(url: URL, headers: Headers, method: string, accessToken?: string): Promise<void>;
  cacheNonce(response: Response, url: URL): void;
}

function signingDPoPHandle(handle: oauth.DPoPHandle): SigningDPoPHandle {
  const signer = handle as SigningDPoPHandle;
  if (typeof signer.addProof !== 'function' || typeof signer.cacheNonce !== 'function') {
    throw new Error('The installed OAuth implementation cannot sender-constrain grant revocation.');
  }
  return signer;
}

export interface LoopbackAuthorizationReceipt {
  readonly url: URL;
  complete(outcome: LoginCompletionOutcome): Promise<void>;
}

type LoopbackReceiverState = 'listening' | 'callback-accepted' | 'closed';

export class LoopbackAuthorizationReceiver {
  private callbackPromise?: Promise<LoopbackAuthorizationReceipt>;
  private callbackResolve?: (receipt: LoopbackAuthorizationReceipt) => void;
  private callbackReject?: (error: LoginError) => void;
  private receivedReceipt?: LoopbackAuthorizationReceipt;
  private timeout?: NodeJS.Timeout;
  private state: LoopbackReceiverState = 'listening';
  private terminalError?: LoginError;
  private pendingResponse?: ServerResponse;
  private completion?: Promise<void>;

  private constructor(
    private readonly server: Server,
    private readonly callbackPath: string,
    private readonly expectedHost: string,
    private readonly completionUrl: URL,
    public readonly redirectUri: string,
  ) {}

  public static async listen(issuer: URL): Promise<LoopbackAuthorizationReceiver> {
    const callbackPath = LOOPBACK_CALLBACK_PATH;
    let receiver: LoopbackAuthorizationReceiver | undefined;
    const server = createServer((request, response) => {
      if (!receiver) {
        response.writeHead(503).end();
        return;
      }
      receiver.receive(request, response);
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('Unable to determine the interactive login callback address.');
    }
    const expectedHost = `127.0.0.1:${address.port}`;
    receiver = new LoopbackAuthorizationReceiver(
      server,
      callbackPath,
      expectedHost,
      new URL(ACCOUNT_COMPLETION_PATH, issuer.origin),
      `http://${expectedHost}${callbackPath}`,
    );
    return receiver;
  }

  public async waitForCallback(timeoutMs: number, registryAlias?: string): Promise<LoopbackAuthorizationReceipt> {
    if (this.receivedReceipt) return this.receivedReceipt;
    if (this.state === 'closed') {
      throw this.terminalError ?? new LoginError('LOGIN_FAILED', 'The browser authorization listener was closed.');
    }
    if (this.callbackPromise) return this.callbackPromise;
    this.callbackPromise = new Promise<LoopbackAuthorizationReceipt>((resolve, reject) => {
      this.callbackResolve = resolve;
      this.callbackReject = reject;
      this.timeout = setTimeout(() => {
        if (this.state !== 'listening') return;
        this.terminate(
          new LoginError(
            'LOGIN_AUTHORIZATION_TIMEOUT',
            registryAlias
              ? `Login timed out while waiting for browser authorization. Run \`uapkg login --registry ${registryAlias}\` to try again.`
              : 'Login timed out while waiting for browser authorization. Run `uapkg login` to try again.',
          ),
        );
      }, timeoutMs);
    });
    return this.callbackPromise;
  }

  public close(): void {
    this.terminate(new LoginError('LOGIN_FAILED', 'The browser authorization listener was closed.'));
  }

  private receive(request: IncomingMessage, response: ServerResponse): void {
    if (
      this.state !== 'listening' ||
      request.method !== 'GET' ||
      request.headers.host !== this.expectedHost ||
      (request.url !== this.callbackPath && !request.url?.startsWith(`${this.callbackPath}?`))
    ) {
      rejectLoopbackRequest(response);
      return;
    }

    let url: URL;
    try {
      url = new URL(request.url, this.redirectUri);
    } catch {
      rejectLoopbackRequest(response);
      return;
    }
    if (url.origin !== new URL(this.redirectUri).origin || url.pathname !== this.callbackPath) {
      rejectLoopbackRequest(response);
      return;
    }

    this.state = 'callback-accepted';
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.pendingResponse = response;
    const receipt: LoopbackAuthorizationReceipt = {
      url,
      complete: (outcome) => this.complete(response, outcome),
    };
    this.receivedReceipt = receipt;
    this.callbackResolve?.(receipt);
    this.callbackResolve = undefined;
    this.callbackReject = undefined;
  }

  private complete(response: ServerResponse, outcome: LoginCompletionOutcome): Promise<void> {
    if (this.completion) return this.completion;
    this.completion = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.pendingResponse = undefined;
        this.close();
        resolve();
      };
      response.once('finish', finish);
      response.once('close', finish);
      response.once('error', finish);

      if (response.destroyed || response.writableEnded) {
        finish();
        return;
      }

      const location = new URL(this.completionUrl);
      location.hash = new URLSearchParams({ result: outcome }).toString();
      try {
        response
          .writeHead(303, {
            location: location.href,
            'cache-control': 'no-store',
            'referrer-policy': 'no-referrer',
            'content-length': '0',
            'x-content-type-options': 'nosniff',
            connection: 'close',
          })
          .end();
      } catch {
        finish();
      }
    });
    return this.completion;
  }

  private terminate(error: LoginError): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.terminalError = error;
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    this.callbackReject?.(error);
    this.callbackResolve = undefined;
    this.callbackReject = undefined;
    if (this.pendingResponse && !this.pendingResponse.writableEnded) {
      this.pendingResponse.destroy();
    }
    this.pendingResponse = undefined;
    this.server.close();
  }
}

function rejectLoopbackRequest(response: ServerResponse): void {
  response
    .writeHead(404, {
      'cache-control': 'no-store',
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    })
    .end('Not found.');
}

function normalizeDeviceName(value?: string): string {
  const candidate = value?.trim() || hostname().trim() || 'UAPKG CLI';
  return candidate.slice(0, 80);
}

function oidcDiscoveryUrl(issuer: URL): URL {
  const discoveryUrl = new URL(issuer);
  discoveryUrl.pathname = `${discoveryUrl.pathname.replace(/\/+$/, '')}/.well-known/openid-configuration`;
  return discoveryUrl;
}

function timestampFromIso(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error('The authorization server returned an invalid registry-grant expiration.');
  }
  return Math.floor(parsed / 1000);
}

function missingKeyError(trust: RegistryTrust): Error {
  return new Error(
    [
      `The saved login for "${trust.alias}" cannot be used because its device-bound signing key is missing or has changed.`,
      '',
      'This can happen after copying configuration to another computer, resetting secure storage,',
      'restoring an incomplete backup, or reinstalling the operating system.',
      '',
      `Run \`uapkg login --registry ${trust.alias} --reauthorize\` to authorize this device again.`,
    ].join('\n'),
  );
}

function loginFinalizationTimeoutError(registryAlias: string): LoginError {
  return new LoginError(
    'LOGIN_AUTHORIZATION_TIMEOUT',
    `Login timed out while verifying and saving browser authorization. No new login was saved. Run \`uapkg login --registry ${registryAlias}\` to try again.`,
  );
}

function emitLoginProgress(onProgress: LoginOptions['onProgress'], event: LoginProgressEvent): void {
  try {
    onProgress?.(event);
  } catch {
    // Reporting must never change the authorization outcome.
  }
}

function authorizationResponseLoginError(error: unknown): LoginError {
  if (error instanceof oauth.AuthorizationResponseError) {
    const oauthError = sanitizeOAuthErrorIdentifier(error.error);
    const description = sanitizeOAuthErrorDescription(error.error_description);
    if (oauthError === 'access_denied') {
      return new LoginError(
        'LOGIN_ACCESS_DENIED',
        `Login denied: ${description ?? 'The user denied the registry grant.'} (access_denied)`,
        oauthError,
      );
    }
    return new LoginError(
      'LOGIN_OAUTH_ERROR',
      `Login failed: ${description ?? 'The authorization server rejected the request.'}${oauthError ? ` (${oauthError})` : ''}`,
      oauthError,
    );
  }
  return new LoginError(
    'LOGIN_AUTHORIZATION_RESPONSE_INVALID',
    'The browser authorization response was invalid. Run `uapkg login` again.',
  );
}

function normalizeLoginError(error: unknown): LoginError {
  if (error instanceof LoginError) return error;
  if (error instanceof oauth.AuthorizationResponseError) return authorizationResponseLoginError(error);
  if (error instanceof oauth.ResponseBodyError) {
    const oauthError = sanitizeOAuthErrorIdentifier(error.error);
    const description = sanitizeOAuthErrorDescription(error.error_description);
    return new LoginError(
      'LOGIN_OAUTH_ERROR',
      `Login failed: ${description ?? 'The authorization server rejected the request.'}${oauthError ? ` (${oauthError})` : ''}`,
      oauthError,
    );
  }
  return new LoginError('LOGIN_FAILED', describeControlPlaneError(error));
}

function sanitizeOAuthErrorIdentifier(value: string | undefined): string | undefined {
  return value && /^[a-z][a-z0-9._~-]{0,63}$/i.test(value) ? value : undefined;
}

function sanitizeOAuthErrorDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return isUnsafeOAuthDescriptionCodePoint(codePoint) ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? Array.from(sanitized).slice(0, 300).join('') : undefined;
}

function isUnsafeOAuthDescriptionCodePoint(codePoint: number): boolean {
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x061c ||
    codePoint === 0x200e ||
    codePoint === 0x200f ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

export function loginDiagnosticForError(error: unknown): ControlPlaneDiagnostic {
  const loginError = normalizeLoginError(error);
  return {
    level: 'error',
    code: loginError.code,
    message: loginError.message,
    data: loginError.oauthError ? { oauthError: loginError.oauthError } : {},
  } as ControlPlaneDiagnostic;
}

export function describeControlPlaneError(error: unknown): string {
  if (error instanceof LoginError) return error.message;
  if (error instanceof ControlPlaneError) {
    if (error.status === 401 && requiresSavedLoginRenewal(error.code)) {
      return `${error.message}\n\nRun \`uapkg login\` to authenticate again.`;
    }
    return `${error.message} (${error.code})`;
  }
  return error instanceof Error ? error.message : String(error);
}

function requiresSavedLoginRenewal(code: string): boolean {
  const normalized = code.toUpperCase();
  return (
    normalized.startsWith('DPOP_') ||
    normalized.startsWith('REGISTRY_GRANT_') ||
    normalized === 'CONTROL_PLANE_AUTHENTICATION_REQUIRED' ||
    normalized === 'CLI_ACCESS_TOKEN_INVALID' ||
    normalized === 'CLI_ACCESS_TOKEN_EXPIRED'
  );
}
