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
  controlPlaneDiagnosticForError,
  describeControlPlaneError,
  type LoginProgressEvent,
  LoopbackAuthorizationReceiver,
  loginDiagnosticForError,
} from '../../src/control-plane/AccountManager.js';
import type { AuthMetadataStore } from '../../src/control-plane/AuthMetadataStore.js';
import {
  ControlPlaneError,
  OAuthScopeInsufficientError,
  OAuthScopeUnsupportedError,
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

const account = {
  id: '20000000-0000-4000-a000-000000000020',
  username: 'maximdevoir+ts1',
  displayName: 'Maxim Devoir',
} as const;

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

  it('renders an action-specific second-factor challenge without depending on structured details', () => {
    const error = new ControlPlaneError(
      'SECOND_FACTOR_REQUIRED',
      'A TOTP code is required for this action (package.publish).',
      403,
      { action: 'package.publish' },
    );

    expect(describeControlPlaneError(error)).toBe(
      'A TOTP code is required for this action (package.publish). (SECOND_FACTOR_REQUIRED)',
    );
    expect(controlPlaneDiagnosticForError(error, 'publish')).toEqual({
      level: 'error',
      code: 'CONTROL_PLANE_COMMAND_FAILED',
      message: 'A TOTP code is required for this action (package.publish). (SECOND_FACTOR_REQUIRED)',
      data: {
        operation: 'publish',
        serverCode: 'SECOND_FACTOR_REQUIRED',
        status: 403,
      },
    });
  });

  it('maps control-plane failures to stable command diagnostics without server details', () => {
    const diagnostic = controlPlaneDiagnosticForError(
      new ControlPlaneError('ACCOUNT_NOT_FOUND', 'The account was not found.', 404, {
        internalRequestId: 'secret-request-id',
      }),
      'whoami',
    );

    expect(diagnostic).toEqual({
      level: 'error',
      code: 'CONTROL_PLANE_COMMAND_FAILED',
      message: 'The account was not found. (ACCOUNT_NOT_FOUND)',
      data: {
        operation: 'whoami',
        serverCode: 'ACCOUNT_NOT_FOUND',
        status: 404,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('secret-request-id');
  });

  it('omits untrusted control-plane metadata from command diagnostics', () => {
    const diagnostic = controlPlaneDiagnosticForError(
      new ControlPlaneError('invalid\nserver code', 'The request failed.', 999),
      'whoami',
    );

    expect(diagnostic.data).toEqual({ operation: 'whoami' });
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
      const parameters = body as URLSearchParams;
      expect(parameters.get('client_id')).toBe('uapkg-cli');
      expect(parameters.get('response_type')).toBe('code');
      expect(parameters.get('code_challenge')).toBeTruthy();
      expect(parameters.get('code_challenge_method')).toBe('S256');
      expect(parameters.get('state')).toBeTruthy();
      expect(parameters.get('nonce')).toBeTruthy();
      expect(parameters.get('scope')).toBe(['openid', 'offline_access', ...UAPKG_CLI_SCOPES].join(' '));
      expect(parameters.get('prompt')).toBe('consent');
      expect(parameters.get('resource')).toBe(trust.resource);
      expect(parameters.get('dpop_jkt')).toBeTruthy();
      expect(parameters.get('registry_id')).toBe(trust.registryId);
      expect(parameters.get('registry_source_fingerprint')).toBe(trust.repositoryFingerprint);
      expect(parameters.get('device_name')).toBeTruthy();
      expect(parameters.get('max_age')).toBe('300');
      expect(parameters.get('replace_grant_id')).toBeNull();
      const redirectUri = new URL(parameters.get('redirect_uri') ?? '');
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

    await expect(
      manager.login(trust, { reauthorize: true, onProgress: (event) => progress.push(event) }),
    ).rejects.toMatchObject({
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
      expect((body as URLSearchParams).get('replace_grant_id')).toBe(previous.grantId);
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

  it('reports browser success only after local persistence and service confirmation', async () => {
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
        expect(body.get('replace_grant_id')).toBeNull();
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        if (init?.method === 'GET') return cliLoginConfirmationResponse(grantId);
        expect(init?.method).toBe('POST');
        expect(metadata.value?.grantId).toBe(grantId);
        await expect(memory.store.get(metadata.value?.refreshTokenReference ?? '')).resolves.toBe('new-refresh-token');
        await expect(new DPoPKeyStore(memory.store).load(metadata.value?.keyReference ?? '')).resolves.toBeDefined();
        return Response.json({ ok: true, grant: { id: grantId, status: 'active', replacesGrantId: null } });
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
      account,
    });
    await expect(memory.store.get(result.grant.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(new DPoPKeyStore(memory.store).load(result.grant.keyReference)).resolves.toBeDefined();
  });

  it('reconciles a committed activation after the POST response is lost', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    let serviceStatus: 'pending' | 'active' = 'pending';
    const confirmationMethods: string[] = [];
    const grantId = '55555555-5555-4555-8555-555555555555';
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
        expect(body.get('replace_grant_id')).toBeNull();
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:lost-confirmation-response', expires_in: 90 },
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        confirmationMethods.push(init?.method ?? 'GET');
        if (init?.method === 'GET') return cliLoginConfirmationResponse(grantId, serviceStatus);
        serviceStatus = 'active';
        throw new TypeError('connection closed after activation committed');
      }
      if (url === `${trust.issuer}/revocation`) {
        throw new Error('The committed refresh token must not be revoked.');
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

    expect(confirmationMethods).toEqual(['GET', 'POST', 'GET']);
    expect(result.grant.grantId).toBe(grantId);
    expect(metadata.value).toEqual(result.grant);
    await expect(memory.store.get(result.grant.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=success',
      }),
    });
  });

  it('does not accept active confirmation responses bound to a different predecessor', async () => {
    const expectedGrantId = '55555555-5555-4555-8555-555555555555';
    const expectedPredecessorGrantId = '11111111-1111-4111-8111-111111111111';
    const controlPlane = {
      confirmCliLogin: vi.fn(async () => ({
        id: expectedGrantId,
        status: 'active' as const,
        replacesGrantId: null,
      })),
      getCliLoginConfirmation: vi.fn(async () => ({
        grant: { id: expectedGrantId, status: 'active' as const, replacesGrantId: null },
      })),
    };
    const manager = new AccountManager(
      new MemoryMetadataStore() as unknown as AuthMetadataStore,
      memoryCredentials().store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );
    const activation = manager as unknown as {
      activatePreparedGrant(
        client: typeof controlPlane,
        credential: unknown,
        grantId: string,
        predecessorGrantId: string | null,
        signal: AbortSignal,
        registryAlias: string,
      ): Promise<{ readonly kind: string }>;
    };

    await expect(
      activation.activatePreparedGrant(
        controlPlane,
        { kind: 'bearer', accessToken: 'unused' },
        expectedGrantId,
        expectedPredecessorGrantId,
        new AbortController().signal,
        trust.alias,
      ),
    ).resolves.toMatchObject({ kind: 'ambiguous' });
    expect(controlPlane.confirmCliLogin).toHaveBeenCalledOnce();
    expect(controlPlane.getCliLoginConfirmation).toHaveBeenCalledTimes(2);
  });

  it('atomically replaces a saved grant without sending an old-token revocation request', async () => {
    const memory = memoryCredentials();
    const previousPair = await new DPoPKeyStore(memory.store).generate();
    const previous = savedGrant({
      publicKeyThumbprint: await oauth.DPoP({}, previousPair).calculateThumbprint(),
    });
    const metadata = new MemoryMetadataStore(previous);
    await new DPoPKeyStore(memory.store).save(previous.keyReference, previousPair);
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    const revokedTokens: string[] = [];
    const grantId = '77777777-7777-4777-8777-777777777777';
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
        expect(body.get('replace_grant_id')).toBe(previous.grantId);
        expect(body.get('device_name')).toBe('renamed workstation');
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:cleanup-after-success', expires_in: 90 },
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        if (init?.method === 'GET') {
          return cliLoginConfirmationResponse(grantId, 'pending', previous.grantId);
        }
        await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBe('old-refresh-token');
        await expect(new DPoPKeyStore(memory.store).load(previous.keyReference)).resolves.toBeDefined();
        return Response.json({
          ok: true,
          grant: { id: grantId, status: 'active', replacesGrantId: previous.grantId },
        });
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
      2_000,
    );
    const accessTokenCache = (manager as unknown as { accessTokenCache: Map<string, unknown> }).accessTokenCache;
    accessTokenCache.set(`${trust.issuer}|${trust.registryId}|${previous.grantId}|identity.self.read`, {});

    const result = await manager.login(trust, { deviceName: 'renamed workstation', reauthorize: true });

    expect(result).toMatchObject({ grant: { grantId }, warnings: [] });
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=success',
      }),
    });
    expect(metadata.value).toEqual(result.grant);
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBeUndefined();
    await expect(new DPoPKeyStore(memory.store).load(previous.keyReference)).resolves.toBeUndefined();
    await expect(memory.store.get(result.grant.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(new DPoPKeyStore(memory.store).load(result.grant.keyReference)).resolves.toBeDefined();
    expect(accessTokenCache.size).toBe(0);
    expect(revokedTokens).toEqual([]);
  });

  it('preserves a newer local slot when it changes while reauthorization is in progress', async () => {
    const previous = savedGrant();
    const metadata = new MemoryMetadataStore(previous);
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    const keyStore = new DPoPKeyStore(memory.store);
    const newerPair = await keyStore.generate();
    const newer = savedGrant({
      grantId: '99999999-9999-4999-8999-999999999999',
      keyReference: 'dpop-key:99999999-9999-4999-8999-999999999999',
      refreshTokenReference: 'grant:99999999-9999-4999-8999-999999999999',
      publicKeyThumbprint: await oauth.DPoP({}, newerPair).calculateThumbprint(),
    });
    await keyStore.save(newer.keyReference, newerPair);
    await memory.store.set(newer.refreshTokenReference, 'newer-refresh-token');
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    let confirmationPosts = 0;
    const revokedTokens: string[] = [];
    const pendingGrantId = '88888888-8888-4888-8888-888888888888';
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
        expect(body.get('replace_grant_id')).toBe(previous.grantId);
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:local-slot-conflict', expires_in: 90 },
          { status: 201 },
        );
      }
      if (url === `${trust.issuer}/token`) {
        return Response.json({
          access_token: 'pending-access-token',
          refresh_token: 'pending-refresh-token',
          token_type: 'DPoP',
          expires_in: 300,
          id_token: testIdToken(nonce),
        });
      }
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        if (init?.method === 'POST') {
          confirmationPosts += 1;
          throw new Error('The conflicting login must not be confirmed.');
        }
        metadata.value = newer;
        return cliLoginConfirmationResponse(pendingGrantId, 'pending', previous.grantId);
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
      2_000,
    );

    await expect(manager.login(trust, { reauthorize: true })).rejects.toMatchObject({
      code: 'LOGIN_REAUTHORIZATION_CONFLICT',
      message: expect.stringContaining('newer local login was preserved'),
    });

    expect(confirmationPosts).toBe(0);
    expect(metadata.value).toEqual(newer);
    await expect(memory.store.get(newer.refreshTokenReference)).resolves.toBe('newer-refresh-token');
    await expect(keyStore.load(newer.keyReference)).resolves.toBeDefined();
    expect(revokedTokens).toEqual(['pending-refresh-token']);
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
  });

  it('keeps staged credentials when activation remains ambiguous after reconciliation', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    let confirmationGets = 0;
    let confirmationPosts = 0;
    let revocationRequests = 0;
    const grantId = '66666666-6666-4666-8666-666666666666';
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
          { request_uri: 'urn:ietf:params:oauth:request_uri:ambiguous-confirmation', expires_in: 90 },
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        if (init?.method === 'GET') {
          confirmationGets += 1;
          return cliLoginConfirmationResponse(grantId, 'pending');
        }
        confirmationPosts += 1;
        if (confirmationPosts === 1) throw new TypeError('confirmation response unavailable');
        return Response.json(
          {
            ok: false,
            error: {
              code: 'CLI_LOGIN_CONFIRMATION_REJECTED',
              message: 'The retry was rejected.',
            },
          },
          { status: 403 },
        );
      }
      if (url === `${trust.issuer}/revocation`) {
        revocationRequests += 1;
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
      2_000,
    );

    await expect(manager.login(trust)).rejects.toMatchObject({
      code: 'LOGIN_FAILED',
      message: expect.stringContaining('locally saved credentials were kept'),
    });

    expect(confirmationGets).toBe(3);
    expect(confirmationPosts).toBe(2);
    expect(revocationRequests).toBe(0);
    expect(metadata.value?.grantId).toBe(grantId);
    await expect(memory.store.get(metadata.value?.refreshTokenReference ?? '')).resolves.toBe('new-refresh-token');
    await expect(new DPoPKeyStore(memory.store).load(metadata.value?.keyReference ?? '')).resolves.toBeDefined();
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
  });

  it('rolls back prepared credentials when the service reports a reauthorization race', async () => {
    const previous = savedGrant();
    const metadata = new MemoryMetadataStore(previous);
    const memory = memoryCredentials();
    await memory.store.set(previous.refreshTokenReference, 'old-refresh-token');
    let redirectUri = '';
    let state = '';
    let nonce = '';
    let callbackResponse: Promise<LoopbackHttpResponse> | undefined;
    let preparedGrant: RegistryGrantMetadata | undefined;
    const revokedTokens: string[] = [];
    const progress: LoginProgressEvent[] = [];
    const grantId = '44444444-4444-4444-8444-444444444444';
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
        expect(body.get('replace_grant_id')).toBe(previous.grantId);
        return Response.json(
          { request_uri: 'urn:ietf:params:oauth:request_uri:confirmation-failure', expires_in: 90 },
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        if (init?.method === 'GET') {
          return cliLoginConfirmationResponse(grantId, 'pending', previous.grantId);
        }
        expect(init?.method).toBe('POST');
        expect(metadata.value?.grantId).toBe(grantId);
        preparedGrant = metadata.value;
        await expect(memory.store.get(preparedGrant?.refreshTokenReference ?? '')).resolves.toBe('new-refresh-token');
        await expect(new DPoPKeyStore(memory.store).load(preparedGrant?.keyReference ?? '')).resolves.toBeDefined();
        return Response.json(
          {
            ok: false,
            error: {
              code: 'CLI_LOGIN_REAUTHORIZATION_CONFLICT',
              message: 'Another reauthorization already replaced this login.',
            },
          },
          { status: 409 },
        );
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
      2_000,
    );

    await expect(
      manager.login(trust, { reauthorize: true, onProgress: (event) => progress.push(event) }),
    ).rejects.toMatchObject({
      code: 'LOGIN_REAUTHORIZATION_CONFLICT',
      message: 'Another reauthorization already replaced this login.',
    });
    await expect(callbackResponse).resolves.toMatchObject({
      status: 303,
      headers: expect.objectContaining({
        location: 'https://account.uapkg.dev/cli-login/complete#result=failed',
      }),
    });
    expect(progress.map(({ type }) => type)).toEqual([
      'preparing',
      'opening-browser',
      'waiting-for-decision',
      'approval-received',
      'saving-local-credentials',
      'confirming-with-service',
    ]);
    expect(preparedGrant).toBeDefined();
    expect(metadata.value).toEqual(previous);
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBe('old-refresh-token');
    await expect(memory.store.get(preparedGrant?.refreshTokenReference ?? '')).resolves.toBeUndefined();
    await expect(new DPoPKeyStore(memory.store).load(preparedGrant?.keyReference ?? '')).resolves.toBeUndefined();
    expect(revokedTokens).toEqual(['new-refresh-token']);
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
        expect(body.get('replace_grant_id')).toBe(previous.grantId);
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
      if (url === `${trust.apiBaseUrl}/v1/account/cli-login/confirmation`) {
        return cliLoginConfirmationResponse('33333333-3333-4333-8333-333333333333', 'pending', previous.grantId);
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
    const fetchMock = vi.fn(async () => Response.json(authorizationServerMetadata()));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetchMock = vi.fn(async () => Response.json(authorizationServerMetadata()));
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      if (!init?.body) {
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
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(memory.store.get(grant.refreshTokenReference)).resolves.toBe('rotated-refresh-token');
    expect([...memory.values.values()].join('\n')).not.toContain('memory-only-access-token');
    expect(JSON.stringify(metadata.value)).not.toContain('memory-only-access-token');
  });

  it('maps refresh-token invalid_scope to a typed plural reauthorization error without retrying or opening a browser', async () => {
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
      if (!init?.body) return Response.json(authorizationServerMetadata());
      return Response.json({ error: 'invalid_scope' }, { status: 400 });
    });
    const opener = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      opener,
      () => true,
      immediateGrantLock,
    );

    let failure: unknown;
    try {
      await manager.getAccessCredential(trust, ['publishing.request.create', 'publishing.request.read.self']);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OAuthScopeInsufficientError);
    expect(failure).toMatchObject({
      code: 'OAUTH_SCOPE_INSUFFICIENT',
      status: 403,
      requestedScopes: ['publishing.request.create', 'publishing.request.read.self'],
      requiredScopes: ['publishing.request.create', 'publishing.request.read.self'],
      missingScopes: ['publishing.request.create', 'publishing.request.read.self'],
    });
    expect(describeControlPlaneError(failure)).toBe(
      'Missing authorization scopes `publishing.request.create`, `publishing.request.read.self` for this action.\nRun `uapkg login --registry official --reauthorize` to authorize the capabilities required by this CLI version.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opener).not.toHaveBeenCalled();
  });

  it('uses only a recognized invalid_scope hint and never renders an injected scope', async () => {
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
      if (!init?.body) return Response.json(authorizationServerMetadata());
      return Response.json(
        { error: 'invalid_scope', scope: 'publishing.request.create registry.administrator' },
        { status: 400 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      vi.fn(),
      () => true,
      immediateGrantLock,
    );

    let failure: unknown;
    try {
      await manager.getAccessCredential(trust, ['publishing.request.create', 'publishing.request.read.self']);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ missingScopes: ['publishing.request.create'] });
    const output = describeControlPlaneError(failure);
    expect(output).toContain('Missing authorization scope `publishing.request.create`');
    expect(output).not.toContain('registry.administrator');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects a cached token when fresh issuer metadata omits its scope, without reauthorization advice', async () => {
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
    let discoveryRequests = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (!init?.body) {
        discoveryRequests += 1;
        return Response.json({
          ...authorizationServerMetadata(),
          ...(discoveryRequests > 1 ? { scopes_supported: ['openid', 'offline_access', 'identity.self.read'] } : {}),
        });
      }
      return Response.json({
        access_token: 'cached-access-token',
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

    await expect(manager.getAccessCredential(trust, ['publishing.request.create'])).resolves.toMatchObject({
      credential: { accessToken: 'cached-access-token' },
    });

    let failure: unknown;
    try {
      await manager.getAccessCredential(trust, ['publishing.request.create']);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OAuthScopeUnsupportedError);
    expect(failure).toMatchObject({
      code: 'OAUTH_SCOPE_UNSUPPORTED',
      requestedScopes: ['publishing.request.create'],
      unsupportedScopes: ['publishing.request.create'],
    });
    const output = describeControlPlaneError(failure);
    expect(output).toContain('does not support the OAuth scope required by this UAPKG CLI');
    expect(output).toContain('Update UAPKG CLI');
    expect(output).not.toContain('uapkg login');
    expect(output).not.toContain('reauthorize');
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it('cleans up a replaced grant locally even when its old DPoP key is missing', async () => {
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
      persistPreparedGrant(
        grant: RegistryGrantMetadata,
        pair: oauth.CryptoKeyPair,
        refreshToken: string,
        previous?: RegistryGrantMetadata,
      ): Promise<void>;
      cleanupPreviousLocalCredentials(
        grant: RegistryGrantMetadata,
        previous?: RegistryGrantMetadata,
      ): Promise<readonly string[]>;
    };

    await persistence.persistPreparedGrant(replacement, newPair, 'new-refresh-token', previous);
    const warnings = await persistence.cleanupPreviousLocalCredentials(replacement, previous);

    expect(metadata.value).toEqual(replacement);
    await expect(memory.store.get(replacement.refreshTokenReference)).resolves.toBe('new-refresh-token');
    await expect(keyStore.load(replacement.keyReference)).resolves.toBeDefined();
    await expect(memory.store.get(previous.refreshTokenReference)).resolves.toBeUndefined();
    expect(warnings).toEqual([]);
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
      persistPreparedGrant(
        grant: RegistryGrantMetadata,
        pair: oauth.CryptoKeyPair,
        refreshToken: string,
        previous: RegistryGrantMetadata,
        signal: AbortSignal,
      ): Promise<readonly string[]>;
    };

    await expect(
      persistence.persistPreparedGrant(replacement, newPair, 'new-refresh-token', previous, controller.signal),
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
    grantId: '11111111-1111-4111-8111-111111111111',
    clientId: 'uapkg-cli',
    keyReference: 'dpop-key:11111111-1111-4111-8111-111111111111',
    refreshTokenReference: 'grant:11111111-1111-4111-8111-111111111111',
    publicKeyThumbprint: 'thumbprint',
    deviceName: 'workstation',
    repositoryFingerprint: trust.repositoryFingerprint,
    account,
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
    scopes_supported: ['openid', 'offline_access', ...UAPKG_CLI_SCOPES],
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

function cliLoginConfirmationResponse(
  grantId: string,
  status: 'pending' | 'active' = 'pending',
  replacesGrantId: string | null = null,
): Response {
  const now = Date.now();
  return Response.json({
    ok: true,
    account,
    registry: { id: trust.registryId },
    grant: {
      id: grantId,
      status,
      deviceName: 'test workstation',
      idleExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
      absoluteExpiresAt: new Date(now + 180 * 24 * 60 * 60 * 1000).toISOString(),
      activationExpiresAt: new Date(now + 60_000).toISOString(),
      replacesGrantId,
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
