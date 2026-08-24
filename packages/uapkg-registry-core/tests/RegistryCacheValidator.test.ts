import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import type { RegistryIdentifier, UnixTimestamp } from '@uapkg/common-schema';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { getRegistryCachePath, getRegistryMetadataPath, getRegistryRepoPath } from '../src/paths/RegistryPaths.ts';
import { RegistryCacheValidator } from '../src/registry/RegistryCacheValidator.ts';
import { RegistryMetadataReader } from '../src/registry/RegistryMetadataReader.ts';

const shortId = '0123456789abcdef';
const expectedIdentifier = 'a'.repeat(64) as RegistryIdentifier;
const previousProfileHome = process.env[INTERNAL_PROFILE_HOME_ENV];
let profileHome: string;

beforeEach(async () => {
  profileHome = await mkdtemp(join(tmpdir(), 'uapkg-cache-validator-'));
  process.env[INTERNAL_PROFILE_HOME_ENV] = profileHome;
});

afterEach(async () => {
  if (previousProfileHome === undefined) {
    delete process.env[INTERNAL_PROFILE_HOME_ENV];
  } else {
    process.env[INTERNAL_PROFILE_HOME_ENV] = previousProfileHome;
  }
  await rm(profileHome, { recursive: true, force: true });
});

describe('RegistryCacheValidator', () => {
  it('accepts absent, empty, and under-lock .lock-only cache directories as uninitialized', async () => {
    const validator = createValidator();

    await expect(validator.inspect()).resolves.toEqual({
      ok: true,
      value: { initialized: false },
      diagnostics: [],
    });

    await mkdir(getRegistryCachePath(shortId), { recursive: true });
    await expect(validator.inspect()).resolves.toMatchObject({
      ok: true,
      value: { initialized: false },
    });

    await writeFile(join(getRegistryCachePath(shortId), '.lock'), '{}', 'utf8');
    await expect(validator.inspect()).resolves.toMatchObject({
      ok: true,
      value: { initialized: false },
    });
  });

  it('rejects a non-empty cache without a repository or metadata as corrupt', async () => {
    await mkdir(join(getRegistryCachePath(shortId), 'packages'), { recursive: true });

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('CACHE_CORRUPT');
  });

  it('rejects a cloned repository without registry metadata as corrupt', async () => {
    await mkdir(getRegistryRepoPath(shortId), { recursive: true });

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'CACHE_CORRUPT',
      data: { cachePath: getRegistryCachePath(shortId) },
    });
  });

  it('rejects registry metadata without a cloned repository as corrupt', async () => {
    await mkdir(getRegistryCachePath(shortId), { recursive: true });
    await writeValidMetadata(expectedIdentifier);

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('CACHE_CORRUPT');
  });

  it('rejects malformed registry metadata as corrupt', async () => {
    await mkdir(getRegistryRepoPath(shortId), { recursive: true });
    await writeFile(getRegistryMetadataPath(shortId), '{"lastRegistrySyncAt":', 'utf8');

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'CACHE_CORRUPT',
      data: { cachePath: getRegistryMetadataPath(shortId) },
    });
  });

  it('rejects registry metadata with an invalid shape as corrupt', async () => {
    await mkdir(getRegistryRepoPath(shortId), { recursive: true });
    await writeFile(
      getRegistryMetadataPath(shortId),
      JSON.stringify({ lastRegistrySyncAt: '100', registryIdentifier: 'not-a-sha256' }),
      'utf8',
    );

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('CACHE_CORRUPT');
  });

  it('reports a dedicated collision when the stored full identifier differs', async () => {
    const actualIdentifier = 'b'.repeat(64) as RegistryIdentifier;
    await mkdir(getRegistryRepoPath(shortId), { recursive: true });
    await writeValidMetadata(actualIdentifier);

    const result = await createValidator().inspect();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'CACHE_IDENTIFIER_COLLISION',
      data: {
        cachePath: getRegistryCachePath(shortId),
        expectedIdentifier,
        actualIdentifier,
      },
    });
  });

  it('returns validated freshness metadata for the expected registry', async () => {
    await mkdir(getRegistryRepoPath(shortId), { recursive: true });
    await writeValidMetadata(expectedIdentifier, 123 as UnixTimestamp);

    await expect(createValidator().inspect()).resolves.toMatchObject({
      ok: true,
      value: {
        initialized: true,
        lastRegistrySyncAt: 123,
      },
    });
  });
});

function createValidator(): RegistryCacheValidator {
  const reader = new RegistryMetadataReader(shortId);
  return new RegistryCacheValidator(shortId, expectedIdentifier, reader);
}

async function writeValidMetadata(
  registryIdentifier: RegistryIdentifier,
  lastRegistrySyncAt = 100 as UnixTimestamp,
): Promise<void> {
  await writeFile(getRegistryMetadataPath(shortId), JSON.stringify({ lastRegistrySyncAt, registryIdentifier }), 'utf8');
}
