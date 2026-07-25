import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

describe('AuthMetadataStore', () => {
  it('persists only non-secret grant metadata and keys it by issuer plus registry id', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'uapkg-auth-metadata-'));
    const path = join(directory, 'auth.json');
    const store = new AuthMetadataStore(path);

    await store.upsert(grant);
    await expect(store.find(grant.issuer, grant.registryId)).resolves.toEqual(grant);

    const raw = await readFile(path, 'utf8');
    expect(raw).toContain('"schemaVersion": 1');
    expect(raw).toContain('"refreshTokenReference": "grant:opaque"');
    expect(raw).not.toContain('refresh_token');
    expect(raw).not.toContain('privateKey');

    await store.remove(grant.issuer, grant.registryId);
    await expect(store.find(grant.issuer, grant.registryId)).resolves.toBeUndefined();
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
});
