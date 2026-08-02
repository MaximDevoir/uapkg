import { webcrypto } from 'node:crypto';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import * as oauth from 'oauth4webapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AccountManager,
  describeControlPlaneError,
  type LoginProgressEvent,
  LoopbackAuthorizationReceiver,
  loginDiagnosticForError,
} from '../../src/control-plane/AccountManager.js';
import type { AuthMetadataStore } from '../../src/control-plane/AuthMetadataStore.js';
import {
  ControlPlaneError,
  type RegistryGrantMetadata,
  type RegistryTrust,
  UAPKG_CLI_SCOPES,
} from '../../src/control-plane/ControlPlaneTypes.js';
import { CredentialStore } from '../../src/control-plane/CredentialStore.js';
import { DPoPKeyStore } from '../../src/control-plane/DPoPKeyStore.js';
import { FileRegistryGrantLock, type RegistryGrantLock } from '../../src/control-plane/RegistryGrantLock.js';

const trust: RegistryTrust = {
  alias: 'official',
  registryId: '00000000-0000-4000-a000-000000000020',
  registryName: 'Official',
  repositoryUrl: 'https://github.com/uapkg/registry.git',
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  issuer: 'https://account.uapkg.dev/oauth',
  apiBaseUrl: 'https://api.uapkg.dev',
  resource: 'https://api.uapkg.dev/v1/registries/00000000-0000-4000-a000-000000000020',
  cacheShortId: 'short-id',
};

const immediateGrantLock: RegistryGrantLock = {
  withLock: async (_issuer, _registryId, operation) => operation(),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('AccountManager', () => {
  it('uses the selected profile for its default grant lock when metadata is duck-typed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-account-profile-'));
    const profileRoot = join(directory, 'selected-profile');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profileRoot);
    const metadata = { find: vi.fn(async () => undefined) };

    try {
      const manager = new AccountManager(metadata as unknown as AuthMetadataStore);

      await expect(manager.logout(trust, true)).resolves.toBe('not-logged-in');
      expect(metadata.find).toHaveBeenCalledWith(trust.issuer, trust.registryId);
      await expect(readdir(join(profileRoot, 'auth-locks'))).resolves.toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the default grant lock beside a custom metadata path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-account-custom-auth-'));
    const profileRoot = join(directory, 'unselected-profile');
    const customDirectory = join(directory, 'custom-auth');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profileRoot);
    const metadata = {
      path: join(customDirectory, 'credentials.json'),
      find: vi.fn(async () => undefined),
    };

    try {
      const manager = new AccountManager(metadata as unknown as AuthMetadataStore);

      await expect(manager.logout(trust, true)).resolves.toBe('not-logged-in');
      await expect(readdir(join(customDirectory, 'auth-locks'))).resolves.toEqual([]);
      await expect(access(profileRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds relogin guidance only to saved-login authentication failures', () => {
    expect(
      describeControlPlaneError(new ControlPlaneError('DPOP_PROOF_INVALID', 'The DPoP proof was rejected.', 401)),
    ).toContain('Run `uapkg login`');
    expect(
      describeControlPlaneError(new ControlPlaneError('GAT_EXPIRED', 'The granular access token expired.', 401)),
    ).toBe('The granular access token expired. (GAT_EXPIRED)');
    expect(
      describeControlPlaneError(
        new ControlPlaneError('OIDC_IDENTITY_REJECTED', 'The workload identity was rejected.', 401),
      ),
    ).not.toContain('uapkg login');
  });

  it('fails before keyring or network use when interactive login is unavailable', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const fetchMock = vi.fn();
    const opener = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      opener,
      () => false,
      immediateGrantLock,
    );

    await expect(manager.login(trust)).rejects.toThrow('Persistent login is not supported in headless environments.');
    expect(memory.loadKeyring).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(opener).not.toHaveBeenCalled();
  });

  it('rejects project- or registry-supplied control-plane endpoints before using credentials or the network', async () => {
    const memory = memoryCredentials();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      new MemoryMetadataStore() as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    await expect(
      manager.login({
        ...trust,
        issuer: 'https://untrusted.example.invalid/oauth',
        apiBaseUrl: 'https://untrusted.example.invalid',
        resource: `https://untrusted.example.invalid/v1/registries/${trust.registryId}`,
      }),
    ).rejects.toThrow('does not accept project-configured authorization issuers or API URLs');
    expect(memory.loadKeyring).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the pinned issuer, discovery URL, and status without including the response body', async () => {
    const memory = memoryCredentials();
    const fetchMock = vi.fn(
      async () =>
        new Response('refresh_token=do-not-report-this-value', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      new MemoryMetadataStore() as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    let loginError: unknown;
    try {
      await manager.login(trust);
    } catch (error) {
      loginError = error;
    }

    expect(loginError).toBeInstanceOf(Error);
    const message = (loginError as Error).message;
    expect(message).toContain('build-pinned issuer "https://account.uapkg.dev/oauth"');
    expect(message).toContain('discovery URL "https://account.uapkg.dev/oauth/.well-known/openid-configuration"');
    expect(message).toContain('HTTP 502');
    expect(message).not.toContain('do-not-report-this-value');
    expect((loginError as Error).cause).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://account.uapkg.dev/oauth/.well-known/openid-configuration',
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    );
  });

  it('falls back to a one-time URL and keeps waiting when the browser opener fails', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const opener = vi.fn(async (_url: string) => {
      throw new Error('browser unavailable');
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json(authorizationServerMetadata());
      }
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const redirectUri = new URL((body as URLSearchParams).get('redirect_uri') ?? '');
      expect(redirectUri.hostname).toBe('127.0.0.1');
      expect(Number(redirectUri.port)).toBeGreaterThan(0);
      expect(redirectUri.pathname).toBe('/callback');
      return Response.json(
        {
          request_uri: 'urn:ietf:params:oauth:request_uri:test',
          expires_in: 90,
        },
        { status: 201 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const progress: LoginProgressEvent[] = [];
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      opener,
      () => true,
      immediateGrantLock,
      20,
    );

    await expect(manager.login(trust, { onProgress: (event) => progress.push(event) })).rejects.toMatchObject({
      code: 'LOGIN_AUTHORIZATION_TIMEOUT',
      message:
        'Login timed out while waiting for browser authorization. Run `uapkg login --registry official` to try again.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opener).toHaveBeenCalledOnce();
    expect(progress.map(({ type }) => type)).toEqual([
      'preparing',
      'opening-browser',
      'browser-open-failed',
      'waiting-for-decision',
    ]);
    expect(progress[2]).toEqual({
      type: 'browser-open-failed',
      authorizationUrl: opener.mock.calls[0]?.[0],
    });
    expect(metadata.value).toBeUndefined();
  });

  it('reports a validated denial, redirects the helper, and preserves the previous grant', async () => {
    const previous = savedGrant();
    const metadata = new MemoryMetadataStore(previous);
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    let redirectUri = '';
    let state = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    const progress: LoginProgressEvent[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json(authorizationServerMetadata());
      }
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      redirectUri = (body as URLSearchParams).get('redirect_uri') ?? '';
      state = (body as URLSearchParams).get('state') ?? '';
      return Response.json(
        { request_uri: 'urn:ietf:params:oauth:request_uri:denied', expires_in: 90 },
        { status: 201 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const opener = vi.fn(async () => {
      const callback = new URL(redirectUri);
      callback.searchParams.set('error', 'access_denied');
      callback.searchParams.set('error_description', 'The user denied the registry grant.');
      callback.searchParams.set('state', state);
      callback.searchParams.set('iss', trust.issuer);
      callbackResponse = requestLoopback(callback);
    });
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      opener,
      () => true,
      immediateGrantLock,
      2_000,
    );

    await expect(
      manager.login(trust, { reauthorize: true, onProgress: (event) => progress.push(event) }),
    ).rejects.toMatchObject({
      code: 'LOGIN_ACCESS_DENIED',
      message: 'Login denied: The user denied the registry grant. (access_denied)',
      oauthError: 'access_denied',
    });
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      body: '',
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=denied',
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      }),
    });
    expect(progress.map(({ type }) => type)).toEqual(['preparing', 'opening-browser', 'waiting-for-decision']);
    expect(metadata.value).toEqual(previous);
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBe('old-refresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats access_denied with a mismatched state as an invalid response, not a denial', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    let redirectUri = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) return Response.json(authorizationServerMetadata());
      const body = init?.body as URLSearchParams;
      redirectUri = body.get('redirect_uri') ?? '';
      return Response.json(
        { request_uri: 'urn:ietf:params:oauth:request_uri:bad-state', expires_in: 90 },
        { status: 201 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      async () => {
        const callback = new URL(redirectUri);
        callback.searchParams.set('error', 'access_denied');
        callback.searchParams.set('state', 'attacker-state');
        callback.searchParams.set('iss', trust.issuer);
        callbackResponse = requestLoopback(callback);
      },
      () => true,
      immediateGrantLock,
      2_000,
    );

    await expect(manager.login(trust)).rejects.toMatchObject({
      code: 'LOGIN_AUTHORIZATION_RESPONSE_INVALID',
    });
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
  });

  it('bounds post-callback finalization, aborts the token request, and reports failure to the helper', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    let redirectUri = '';
    let state = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    let tokenRequestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json(authorizationServerMetadata());
      }
      if (url === `${trust.issuer}/request`) {
        const body = init?.body as URLSearchParams;
        redirectUri = body.get('redirect_uri') ?? '';
        state = body.get('state') ?? '';
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:finalization-timeout', expires_in: 90 },
          { status: 201 },
        );
      }
      if (url === `${trust.issuer}/token`) {
        tokenRequestSignal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          const rejectWithReason = () => reject(tokenRequestSignal?.reason ?? new Error('token request aborted'));
          if (tokenRequestSignal?.aborted) rejectWithReason();
          else tokenRequestSignal?.addEventListener('abort', rejectWithReason, { once: true });
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      async () => {
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'authorization-code');
        callback.searchParams.set('state', state);
        callback.searchParams.set('iss', trust.issuer);
        callbackResponse = requestLoopback(callback);
      },
      () => true,
      immediateGrantLock,
      2_000,
      20,
    );

    await expect(manager.login(trust)).rejects.toMatchObject({
      code: 'LOGIN_AUTHORIZATION_TIMEOUT',
      message: expect.stringContaining('No new login was saved'),
    });
    expect(tokenRequestSignal?.aborted).toBe(true);
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
    expect(metadata.value).toBeUndefined();
  });

  it('reports browser success only after token exchange, self validation, and durable persistence', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    const grantId = '22222222-2222-4222-8222-222222222222';
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json(authorizationServerMetadata());
      }
      if (url === `${trust.issuer}/request`) {
        const body = init?.body as URLSearchParams;
        redirectUri = body.get('redirect_uri') ?? '';
        state = body.get('state') ?? '';
        nonce = body.get('nonce') ?? '';
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:successful-login', expires_in: 90 },
          { status: 201 },
        );
      }
      if (url === `${trust.issuer}/token`) {
        return Response.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'DPoP',
          expires_in: 300,
          id_token: testIdToken(nonce),
        });
      }
      if (url === `${trust.apiBaseUrl}/v1/account/self`) {
        return accountSelfResponse(grantId);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      async () => {
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'authorization-code');
        callback.searchParams.set('state', state);
        callback.searchParams.set('iss', trust.issuer);
        callbackResponse = requestLoopback(callback);
      },
      () => true,
      immediateGrantLock,
      2_000,
      2_000,
    );

    const result = await manager.login(trust);
    const response = await callbackResponse;

    expect(response).toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=success',
      }),
    });
    expect(metadata.value).toEqual(result.grant);
    expect(result.grant).toMatchObject({
      issuer: trust.issuer,
      registryId: trust.registryId,
      grantId,
      account: { username: 'maximdevoir+ts1', email: 'maximdevoir+ts1@gmail.com' },
    });
    await expect(memory.store.get(result.grant.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(new DPoPKeyStore(memory.store).load(result.grant.keyReference)).resolves.toBeDefined();
  });

  it('rolls back a timed-out approved reauthorization, preserves the old grant, and revokes the new token', async () => {
    const previous = savedGrant();
    const metadata = new MemoryMetadataStore(previous);
    vi.spyOn(metadata, 'upsert').mockImplementation(async (value) => {
      metadata.value = value;
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
    });
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    const revokedTokens: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration')) {
        return Response.json(authorizationServerMetadata());
      }
      if (url === `${trust.issuer}/request`) {
        const body = init?.body as URLSearchParams;
        redirectUri = body.get('redirect_uri') ?? '';
        state = body.get('state') ?? '';
        nonce = body.get('nonce') ?? '';
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:failed-reauthorization', expires_in: 90 },
          { status: 201 },
        );
      }
      if (url === `${trust.issuer}/token`) {
        return Response.json({
          access_token: 'new-access-token',
          refresh_token: 'new-refresh-token',
          token_type: 'DPoP',
          expires_in: 300,
          id_token: testIdToken(nonce),
        });
      }
      if (url === `${trust.apiBaseUrl}/v1/account/self`) {
        return accountSelfResponse('33333333-3333-4333-8333-333333333333');
      }
      if (url === `${trust.issuer}/revocation`) {
        revokedTokens.push((init?.body as URLSearchParams).get('token') ?? '');
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      async () => {
        const callback = new URL(redirectUri);
        callback.searchParams.set('code', 'authorization-code');
        callback.searchParams.set('state', state);
        callback.searchParams.set('iss', trust.issuer);
        callbackResponse = requestLoopback(callback);
      },
      () => true,
      immediateGrantLock,
      2_000,
      20,
    );

    await expect(manager.login(trust, { reauthorize: true })).rejects.toMatchObject({
      code: 'LOGIN_AUTHORIZATION_TIMEOUT',
      message: expect.stringContaining('No new login was saved'),
    });
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
    expect(revokedTokens).toEqual(['new-refresh-token']);
    expect(metadata.value).toEqual(previous);
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBe('old-refresh-token');
  });

  it('sanitizes OAuth denial diagnostics without exposing callback parameters', () => {
    const error = new oauth.AuthorizationResponseError('generic library message', {
      cause: new URLSearchParams({
        error: 'access_denied',
        error_description: `Denied.\r\n\u202efake\u2066 ${'x'.repeat(400)}`,
        state: 'secret-state',
        code: 'secret-authorization-code',
      }),
    });

    const diagnostic = loginDiagnosticForError(error);

    expect(diagnostic).toMatchObject({
      level: 'error',
      code: 'LOGIN_ACCESS_DENIED',
      data: { oauthError: 'access_denied' },
    });
    expect(diagnostic.message).toContain('Login denied: Denied. ');
    expect(diagnostic.message).not.toContain('\n');
    expect(diagnostic.message).not.toContain('\u202e');
    expect(diagnostic.message).not.toContain('\u2066');
    expect(diagnostic.message).not.toContain('secret-state');
    expect(diagnostic.message).not.toContain('secret-authorization-code');
    expect(diagnostic.message.length).toBeLessThanOrEqual(340);

    const codePointBoundary = loginDiagnosticForError(
      new oauth.AuthorizationResponseError('generic library message', {
        cause: new URLSearchParams({
          error: 'access_denied',
          error_description: `${'x'.repeat(299)}😀`,
        }),
      }),
    );
    expect(codePointBoundary.message).toContain(`😀 (access_denied)`);
  });

  it('rejects a mismatched saved DPoP key locally before sending the refresh grant', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const savedPair = await keyStore.generate();
    const differentPair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, differentPair).calculateThumbprint(),
    });
    metadata.value = grant;
    await keyStore.save(grant.keyReference, savedPair);
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    await expect(manager.getAccessCredential(trust, ['identity.self.read'])).rejects.toThrow(
      'device-bound signing key is missing or has changed',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('refresh-token');
  });

  it('rejects mismatched DPoP public and private halves before sending the refresh grant', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const publicPair = await keyStore.generate();
    const differentPair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, publicPair).calculateThumbprint(),
    });
    metadata.value = grant;
    const [publicKey, privateKey] = await Promise.all([
      webcrypto.subtle.exportKey('jwk', publicPair.publicKey),
      webcrypto.subtle.exportKey('jwk', differentPair.privateKey),
    ]);
    await memory.store.set(grant.keyReference, JSON.stringify({ algorithm: 'ES256', publicKey, privateKey }));
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    await expect(manager.getAccessCredential(trust, ['identity.self.read'])).rejects.toThrow(
      'DPoP public and private keys do not match',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('refresh-token');
  });

  it('persists refresh-token rotation while keeping access tokens memory-only', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const pair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, pair).calculateThumbprint(),
    });
    metadata.value = grant;
    await keyStore.save(grant.keyReference, pair);
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json(authorizationServerMetadata());
      }
      const body = init?.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      expect((body as URLSearchParams).get('refresh_token')).toBe('refresh-token');
      expect((body as URLSearchParams).get('resource')).toBe(trust.resource);
      expect((body as URLSearchParams).get('scope')).toBe('identity.self.read');
      expect(new Headers(init?.headers).get('dpop')).toBeTruthy();
      return Response.json({
        access_token: 'memory-only-access-token',
        token_type: 'DPoP',
        expires_in: 300,
        refresh_token: 'rotated-refresh-token',
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    const first = await manager.getAccessCredential(trust, ['identity.self.read']);
    const second = await manager.getAccessCredential(trust, ['identity.self.read']);

    expect(first.credential).toMatchObject({
      kind: 'dpop',
      accessToken: 'memory-only-access-token',
    });
    expect(second.credential).toMatchObject({
      kind: 'dpop',
      accessToken: 'memory-only-access-token',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('rotated-refresh-token');
    expect([...memory.values.values()].join('\n')).not.toContain('memory-only-access-token');
    expect(JSON.stringify(metadata.value)).not.toContain('memory-only-access-token');
  });

  it('serializes concurrent per-grant refreshes and uses the newly rotated token', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const pair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, pair).calculateThumbprint(),
    });
    metadata.value = grant;
    await keyStore.save(grant.keyReference, pair);
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');

    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let markFirstRefreshStarted: (() => void) | undefined;
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve;
    });
    const submittedRefreshTokens: string[] = [];
    let activeRefreshes = 0;
    let maximumConcurrentRefreshes = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.body) {
        return Response.json(authorizationServerMetadata());
      }

      const body = init.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const submittedRefreshToken = (body as URLSearchParams).get('refresh_token');
      expect(submittedRefreshToken).toBeTruthy();
      submittedRefreshTokens.push(submittedRefreshToken ?? '');
      activeRefreshes += 1;
      maximumConcurrentRefreshes = Math.max(maximumConcurrentRefreshes, activeRefreshes);

      if (submittedRefreshTokens.length === 1) {
        markFirstRefreshStarted?.();
        await firstRefreshGate;
      }

      const generation = submittedRefreshTokens.length;
      activeRefreshes -= 1;
      return Response.json({
        access_token: `access-token-${generation}`,
        token_type: 'DPoP',
        expires_in: 300,
        refresh_token: `rotated-refresh-token-${generation}`,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    const identityAccess = manager.getAccessCredential(trust, ['identity.self.read']);
    await firstRefreshStarted;
    const publishingAccess = manager.getAccessCredential(trust, ['publishing.request.create']);
    await Promise.resolve();
    expect(activeRefreshes).toBe(1);
    releaseFirstRefresh?.();

    const [identity, publishing] = await Promise.all([identityAccess, publishingAccess]);

    expect(identity.credential).toMatchObject({ accessToken: 'access-token-1' });
    expect(publishing.credential).toMatchObject({ accessToken: 'access-token-2' });
    expect(submittedRefreshTokens).toEqual(['refresh-token', 'rotated-refresh-token-1']);
    expect(maximumConcurrentRefreshes).toBe(1);
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('rotated-refresh-token-2');
  });

  it('serializes rotating refresh use across independent managers sharing the same registry lock', async () => {
    const lockDirectory = await mkdtemp(join(tmpdir(), 'uapkg-account-manager-lock-'));
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const pair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, pair).calculateThumbprint(),
    });
    metadata.value = grant;
    await keyStore.save(grant.keyReference, pair);
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');

    let releaseFirstRefresh: (() => void) | undefined;
    const firstRefreshGate = new Promise<void>((resolve) => {
      releaseFirstRefresh = resolve;
    });
    let markFirstRefreshStarted: (() => void) | undefined;
    const firstRefreshStarted = new Promise<void>((resolve) => {
      markFirstRefreshStarted = resolve;
    });
    const submittedRefreshTokens: string[] = [];
    let activeRefreshes = 0;
    let maximumConcurrentRefreshes = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.body) {
        return Response.json(authorizationServerMetadata());
      }

      const body = init.body;
      expect(body).toBeInstanceOf(URLSearchParams);
      const submittedRefreshToken = (body as URLSearchParams).get('refresh_token');
      expect(submittedRefreshToken).toBeTruthy();
      submittedRefreshTokens.push(submittedRefreshToken ?? '');
      activeRefreshes += 1;
      maximumConcurrentRefreshes = Math.max(maximumConcurrentRefreshes, activeRefreshes);

      if (submittedRefreshTokens.length === 1) {
        markFirstRefreshStarted?.();
        await firstRefreshGate;
      }

      const generation = submittedRefreshTokens.length;
      activeRefreshes -= 1;
      return Response.json({
        access_token: `cross-process-access-token-${generation}`,
        token_type: 'DPoP',
        expires_in: 300,
        refresh_token: `cross-process-refresh-token-${generation}`,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const lockOptions = {
      waitTimeoutMs: 2_000,
      staleAfterMs: 5_000,
      pollIntervalMs: 2,
      heartbeatIntervalMs: 10,
    };
    const managerA = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      new FileRegistryGrantLock(lockDirectory, lockOptions),
    );
    const managerB = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      new FileRegistryGrantLock(lockDirectory, lockOptions),
    );

    const pending: Promise<unknown>[] = [];
    try {
      const identityAccess = managerA.getAccessCredential(trust, ['identity.self.read']);
      pending.push(identityAccess);
      await firstRefreshStarted;
      const publishingAccess = managerB.getAccessCredential(trust, ['publishing.request.create']);
      pending.push(publishingAccess);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(submittedRefreshTokens).toEqual(['refresh-token']);
      expect(activeRefreshes).toBe(1);
      releaseFirstRefresh?.();

      const [identity, publishing] = await Promise.all([identityAccess, publishingAccess]);
      expect(identity.credential).toMatchObject({
        accessToken: 'cross-process-access-token-1',
      });
      expect(publishing.credential).toMatchObject({
        accessToken: 'cross-process-access-token-2',
      });
      expect(submittedRefreshTokens).toEqual(['refresh-token', 'cross-process-refresh-token-1']);
      expect(maximumConcurrentRefreshes).toBe(1);
      await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('cross-process-refresh-token-2');
    } finally {
      releaseFirstRefresh?.();
      await Promise.allSettled(pending);
      await rm(lockDirectory, { recursive: true, force: true });
    }
  });

  it('retains local state after a remote logout failure and removes it with local-only logout', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const keyStore = new DPoPKeyStore(memory.store);
    const pair = await keyStore.generate();
    const grant = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, pair).calculateThumbprint(),
    });
    metadata.value = grant;
    await keyStore.save(grant.keyReference, pair);
    await memory.store.set(grant.refreshTokenReference, 'refresh-token');

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        return Response.json(authorizationServerMetadata());
      }
      throw new Error('network unavailable');
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    await expect(manager.logout(trust)).rejects.toThrow('The local login was kept so you can retry');
    expect(metadata.value).toEqual(grant);
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('refresh-token');
    await expect(keyStore.load(grant.keyReference)).resolves.toBeDefined();

    await expect(manager.logout(trust, true)).resolves.toBe('removed');
    expect(metadata.value).toBeUndefined();
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBeUndefined();
    await expect(keyStore.load(grant.keyReference)).resolves.toBeUndefined();
  });

  it('keeps a replacement login when the inaccessible previous DPoP grant cannot be revoked', async () => {
    const previous = savedGrant({
      grantId: 'old-grant',
      keyReference: 'dpop-key:missing-old-key',
      refreshTokenReference: 'grant:old-refresh-token',
    });
    const metadata = new MemoryMetadataStore(previous);
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    const keyStore = new DPoPKeyStore(memory.store);
    const newPair = await keyStore.generate();
    const replacement = savedGrant({
      grantId: 'new-grant',
      keyReference: 'dpop-key:new-key',
      refreshTokenReference: 'grant:new-refresh-token',
      publicKeyThumbprint: await oauth.DPoP({}, newPair).calculateThumbprint(),
    });
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );
    const persistence = manager as unknown as {
      persistIssuedGrant(
        grant: RegistryGrantMetadata,
        pair: oauth.CryptoKeyPair,
        refreshToken: string,
        previous?: RegistryGrantMetadata,
      ): Promise<readonly string[]>;
    };

    const warnings = await persistence.persistIssuedGrant(replacement, newPair, 'new-refresh-token', previous);

    expect(metadata.value).toEqual(replacement);
    await expect(memory.store.get(replacement.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(keyStore.load(replacement.keyReference)).resolves.toBeDefined();
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('account website');
  });

  it('reports a failed metadata rollback instead of masking it as a safe timeout', async () => {
    const previous = savedGrant();
    const metadata = new MemoryMetadataStore(previous);
    const controller = new AbortController();
    let upsertCalls = 0;
    vi.spyOn(metadata, 'upsert').mockImplementation(async (value) => {
      upsertCalls += 1;
      if (upsertCalls === 1) {
        metadata.value = value;
        controller.abort(new Error('finalization deadline reached'));
        return;
      }
      throw new Error('metadata rollback unavailable');
    });
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    const keyStore = new DPoPKeyStore(memory.store);
    const newPair = await keyStore.generate();
    const replacement = savedGrant({
      grantId: 'new-grant',
      keyReference: 'dpop-key:new-key',
      refreshTokenReference: 'grant:new-refresh-token',
      publicKeyThumbprint: await oauth.DPoP({}, newPair).calculateThumbprint(),
    });
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );
    const persistence = manager as unknown as {
      persistIssuedGrant(
        grant: RegistryGrantMetadata,
        pair: oauth.CryptoKeyPair,
        refreshToken: string,
        previous: RegistryGrantMetadata,
        signal: AbortSignal,
      ): Promise<readonly string[]>;
    };

    await expect(
      persistence.persistIssuedGrant(replacement, newPair, 'new-refresh-token', previous, controller.signal),
    ).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
      message: expect.stringContaining('could not roll back the local login metadata safely'),
    });
    expect(upsertCalls).toBe(2);
    await expect(memory.store.get(replacement.refreshTokenReference)).resolves.toBeUndefined();
    await expect(keyStore.load(replacement.keyReference)).resolves.toBeUndefined();
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBe('old-refresh-token');
  });
});

describe('LoopbackAuthorizationReceiver', () => {
  it('holds the first exact callback until completion and rejects invalid or duplicate requests', async () => {
    const receiver = await LoopbackAuthorizationReceiver.listen(new URL(trust.issuer));
    try {
      const wrongPath = new URL('/wrong', receiver.redirectUri);
      await expect(requestLoopback(wrongPath)).resolves.toMatchObject({ status: 404 });
      await expect(requestLoopback(new URL(receiver.redirectUri), { method: 'POST' })).resolves.toMatchObject({
        status: 404,
      });
      await expect(
        requestLoopback(new URL(receiver.redirectUri), { host: 'localhost.invalid' }),
      ).resolves.toMatchObject({ status: 404 });

      const callback = new URL(receiver.redirectUri);
      callback.searchParams.set('code', 'secret-code');
      callback.searchParams.set('state', 'secret-state');
      const responsePromise = requestLoopback(callback);
      const receipt = await receiver.waitForCallback(1_000);
      expect(receipt.url.href).toBe(callback.href);

      let responseSettled = false;
      void responsePromise.finally(() => {
        responseSettled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(responseSettled).toBe(false);
      await expect(requestLoopback(callback)).resolves.toMatchObject({ status: 404 });

      await receipt.complete('success');
      const response = await responsePromise;
      expect(response).toMatchObject({
        status: 303,
        body: '',
        headers: expect.objectContaining({
          location: 'https://account.uapkg.dev/cli-login/complete#result=success',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'content-length': '0',
        }),
      });
      expect(JSON.stringify(response)).not.toContain('secret-code');
      expect(JSON.stringify(response)).not.toContain('secret-state');
      await expect(receipt.complete('failed')).resolves.toBeUndefined();
    } finally {
      receiver.close();
    }
  });

  it.each(['denied', 'failed'] as const)('redirects the helper with the %s terminal outcome', async (outcome) => {
    const receiver = await LoopbackAuthorizationReceiver.listen(new URL(trust.issuer));
    try {
      const responsePromise = requestLoopback(new URL(receiver.redirectUri));
      const receipt = await receiver.waitForCallback(1_000);
      await receipt.complete(outcome);
      await expect(responsePromise).resolves.toMatchObject({
        status: 303,
        headers: expect.objectContaining({
          location: `https://account.uapkg.dev/cli-login/complete#result=${outcome}`,
        }),
      });
    } finally {
      receiver.close();
    }
  });

  it('times out with a typed retryable error and closes its listener', async () => {
    const receiver = await LoopbackAuthorizationReceiver.listen(new URL(trust.issuer));
    const callback = new URL(receiver.redirectUri);

    await expect(receiver.waitForCallback(10)).rejects.toEqual(
      expect.objectContaining({
        name: 'LoginError',
        code: 'LOGIN_AUTHORIZATION_TIMEOUT',
        message: expect.stringContaining('Run `uapkg login` to try again'),
      }),
    );
    await expect(requestLoopback(callback)).rejects.toBeDefined();
  });

  it('rejects an already-accepted callback that reaches the receiver after timeout', async () => {
    const receiver = await LoopbackAuthorizationReceiver.listen(new URL(trust.issuer));
    const boundary = receiver as unknown as {
      receive(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void;
    };
    const receive = boundary.receive.bind(receiver);
    let releaseRequest: (() => void) | undefined;
    let markIntercepted: (() => void) | undefined;
    const intercepted = new Promise<void>((resolve) => {
      markIntercepted = resolve;
    });
    boundary.receive = (request, response) => {
      markIntercepted?.();
      void new Promise<void>((resolve) => {
        releaseRequest = resolve;
      }).then(() => receive(request, response));
    };

    try {
      const callbackResponse = requestLoopback(new URL(receiver.redirectUri));
      await intercepted;
      const waiting = receiver.waitForCallback(10);
      await expect(waiting).rejects.toMatchObject({ code: 'LOGIN_AUTHORIZATION_TIMEOUT' });
      releaseRequest?.();
      await expect(callbackResponse).resolves.toMatchObject({ status: 404, body: 'Not found.' });
    } finally {
      releaseRequest?.();
      receiver.close();
    }
  });
});

class MemoryMetadataStore {
  public constructor(public value?: RegistryGrantMetadata) {}

  public async find(issuer: string, registryId: string): Promise<RegistryGrantMetadata | undefined> {
    return this.value?.issuer === issuer && this.value.registryId === registryId ? this.value : undefined;
  }

  public async upsert(value: RegistryGrantMetadata): Promise<void> {
    this.value = value;
  }

  public async remove(issuer: string, registryId: string): Promise<void> {
    if (this.value?.issuer === issuer && this.value.registryId === registryId) {
      this.value = undefined;
    }
  }
}

function memoryCredentials() {
  const values = new Map<string, string>();
  const loadKeyring = vi.fn(async () => ({
    Entry: class {
      public constructor(
        _service: string,
        private readonly reference: string,
      ) {}

      public setPassword(value: string): void {
        values.set(this.reference, value);
      }

      public getPassword(): string | null {
        return values.get(this.reference) ?? null;
      }

      public deleteCredential(): boolean {
        return values.delete(this.reference);
      }
    },
  }));
  return {
    values,
    loadKeyring,
    store: new CredentialStore(loadKeyring),
  };
}

function savedGrant(overrides: Partial<RegistryGrantMetadata> = {}): RegistryGrantMetadata {
  return {
    issuer: trust.issuer,
    registryId: trust.registryId,
    registryName: trust.registryName,
    grantId: 'grant-1',
    clientId: 'uapkg-cli',
    keyReference: 'dpop-key:grant-1',
    refreshTokenReference: 'grant:grant-1',
    publicKeyThumbprint: 'thumbprint',
    deviceName: 'workstation',
    repositoryFingerprint: trust.repositoryFingerprint,
    createdAt: Math.floor(Date.now() / 1000),
    idleExpiresAt: Math.floor(Date.now() / 1000) + 86_400,
    expiresAt: Math.floor(Date.now() / 1000) + 172_800,
    ...overrides,
  };
}

function authorizationServerMetadata(): oauth.AuthorizationServer {
  return {
    issuer: trust.issuer,
    authorization_endpoint: `${trust.issuer}/authorization`,
    token_endpoint: `${trust.issuer}/token`,
    pushed_authorization_request_endpoint: `${trust.issuer}/request`,
    revocation_endpoint: `${trust.issuer}/revocation`,
    code_challenge_methods_supported: ['S256'],
    dpop_signing_alg_values_supported: ['ES256'],
    id_token_signing_alg_values_supported: ['ES256'],
  };
}

function testIdToken(nonce: string): string {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return [
    encode({ alg: 'ES256' }),
    encode({
      iss: trust.issuer,
      aud: 'uapkg-cli',
      sub: 'account-1',
      iat: now,
      exp: now + 300,
      auth_time: now,
      nonce,
    }),
    Buffer.from('test-signature').toString('base64url'),
  ].join('.');
}

function accountSelfResponse(grantId: string): Response {
  const now = Date.now();
  return Response.json({
    ok: true,
    account: {
      id: 'account-1',
      username: 'maximdevoir+ts1',
      email: 'maximdevoir+ts1@gmail.com',
    },
    registry: { id: trust.registryId },
    grant: {
      id: grantId,
      deviceName: 'test workstation',
      idleExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      absoluteExpiresAt: new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString(),
      scopes: [...UAPKG_CLI_SCOPES],
    },
  });
}

interface LoopbackHttpResponse {
  readonly status: number;
  readonly headers: NodeJS.Dict<string | string[]>;
  readonly body: string;
}

function requestLoopback(
  url: URL,
  options: { readonly method?: string; readonly host?: string } = {},
): Promise<LoopbackHttpResponse> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port: Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: options.method ?? 'GET',
        headers: { host: options.host ?? url.host },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.once('error', reject);
    request.end();
  });
}
