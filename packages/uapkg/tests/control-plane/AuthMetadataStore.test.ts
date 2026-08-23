import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { AuthMetadataStore } from '../../src/control-plane/AuthMetadataStore.js';
import type { RegistryGrantMetadata } from '../../src/control-plane/ControlPlaneTypes.js';

const grant: RegistryGrantMetadata = {
  issuer: 'https://account.uapkg.dev/oauth',
  registryId: '00000000-0000-4000-a000-000000000020',
  registryName: 'official',
  grantId: '10000000-0000-4000-a000-000000000020',
  clientId: 'uapkg-cli',
  keyReference: 'dpop-key:opaque',
  refreshTokenReference: 'grant:opaque',
  publicKeyThumbprint: 'thumbprint',
  deviceName: 'workstation',
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  account: {
    id: '20000000-0000-4000-a000-000000000020',
    username: 'maxim',
    displayName: 'Maxim Devoir',
  },
  createdAt: 1_700_000_000,
  idleExpiresAt: 1_702_592_000,
  expiresAt: 1_715_552_000,
};

const otherGrant: RegistryGrantMetadata = {
  ...grant,
  registryId: '00000000-0000-4000-a000-000000000021',
  registryName: 'community',
  grantId: '10000000-0000-4000-a000-000000000021',
  keyReference: 'dpop-key:other-opaque',
  refreshTokenReference: 'grant:other-opaque',
  repositoryFingerprint: `sha256:${'b'.repeat(64)}`,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AuthMetadataStore', () => {
  it('keeps default auth metadata and lock artifacts inside the selected profile', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-auth-profile-'));
    const profileRoot = join(directory, 'selected-profile');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profileRoot);

    try {
      const store = new AuthMetadataStore();
      expect(store.path).toBe(join(profileRoot, 'auth.json'));

      await store.upsert(grant);

      expect((await readdir(profileRoot)).sort()).toEqual(['auth-locks', 'auth.json']);
      await expect(readdir(join(profileRoot, 'auth-locks'))).resolves.toEqual([]);
      await expect(readFile(join(profileRoot, 'auth.json'), 'utf8')).resolves.toContain(
        '"refreshTokenReference": "grant:opaque"',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists only non-secret grant metadata and keys it by issuer plus registry id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-auth-metadata-'));
    const path = join(directory, 'auth.json');
    const unselectedProfileRoot = join(directory, 'unselected-profile');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, unselectedProfileRoot);
    const store = new AuthMetadataStore(path);

    await store.upsert(grant);
    await expect(store.find(grant.issuer, grant.registryId)).resolves.toEqual(grant);

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"schemaVersion": 1');
    expect(raw).toContain('"username": "maxim"');
    expect(raw).toContain('"displayName": "Maxim Devoir"');
    expect(raw).toContain('"refreshTokenReference": "grant:opaque"');
    expect(raw).not.toContain('refresh_token');
    expect(raw).not.toContain('privateKey');

    await store.remove(grant.issuer, grant.registryId);
    await expect(store.find(grant.issuer, grant.registryId)).resolves.toBeUndefined();
    await expect(readdir(join(directory, 'auth-locks'))).resolves.toEqual([]);
    await expect(access(unselectedProfileRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves concurrent updates from independent instances for different registries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-auth-metadata-concurrent-'));
    const path = join(directory, 'auth.json');
    const firstProcess = new AuthMetadataStore(path);
    const secondProcess = new AuthMetadataStore(path);

    await Promise.all([firstProcess.upsert(grant), secondProcess.upsert(otherGrant)]);

    await expect(firstProcess.find(grant.issuer, grant.registryId)).resolves.toEqual(grant);
    await expect(firstProcess.find(otherGrant.issuer, otherGrant.registryId)).resolves.toEqual(otherGrant);
  });

  it.each([
    ['account object', undefined],
    ['canonical username', { id: grant.account.id, displayName: grant.account.displayName }],
    ['display name', { id: grant.account.id, username: grant.account.username }],
  ])('rejects a saved grant whose v1 metadata omits the required %s', async (_field, invalidAccount) => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-auth-metadata-invalid-account-'));
    const path = join(directory, 'auth.json');
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: 1,
        grants: {
          [`${grant.issuer}|${grant.registryId}`]: { ...grant, account: invalidAccount },
        },
      })}\n`,
      'utf8',
    );

    await expect(new AuthMetadataStore(path).find(grant.issuer, grant.registryId)).rejects.toThrow(
      'Saved UAPKG login metadata',
    );
  });
});
