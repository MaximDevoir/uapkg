import { webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as oauth from 'oauth4webapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountManager, describeControlPlaneError } from '../../src/control-plane/AccountManager.js';
import type { AuthMetadataStore } from '../../src/control-plane/AuthMetadataStore.js';
import {
  ControlPlaneError,
  type RegistryGrantMetadata,
  type RegistryTrust,
} from '../../src/control-plane/ControlPlaneTypes.js';
import { CredentialStore } from '../../src/control-plane/CredentialStore.js';
import { DPoPKeyStore } from '../../src/control-plane/DPoPKeyStore.js';
import { FileRegistryGrantLock, type RegistryGrantLock } from '../../src/control-plane/RegistryGrantLock.js';

const trust: RegistryTrust = {
  alias: 'official',
  registryId: '00000000-0000-4000-a000-000000000020',
  registryName: 'Official',
  registryIdentifier: 'identifier',
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
  vi.unstubAllGlobals();
});

describe('AccountManager', () => {
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

  it('closes the login attempt and fails clearly when the browser opener fails', async () => {
    const metadata = new MemoryMetadataStore();
    const memory = memoryCredentials();
    const opener = vi.fn(async () => {
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
    const manager = new AccountManager(
      metadata as unknown as AuthMetadataStore,
      memory.store,
      opener,
      () => true,
      immediateGrantLock,
    );

    await expect(manager.login(trust)).rejects.toThrow('browser unavailable');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(opener).toHaveBeenCalledOnce();
    expect(metadata.value).toBeUndefined();
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
  };
}
