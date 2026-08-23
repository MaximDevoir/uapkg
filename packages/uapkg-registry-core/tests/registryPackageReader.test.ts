import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { getRegistryRepoPath } from '../src/paths/RegistryPaths.js';
import { RegistryPackageReader } from '../src/registry/RegistryPackageReader.js';

const shortId = 'schema-context-test';
const previousProfileHome = process.env[INTERNAL_PROFILE_HOME_ENV];
let profileHome: string;

beforeEach(async () => {
  profileHome = await mkdtemp(join(tmpdir(), 'uapkg-registry-schema-context-'));
  process.env[INTERNAL_PROFILE_HOME_ENV] = profileHome;
});

afterEach(async () => {
  if (previousProfileHome === undefined) delete process.env[INTERNAL_PROFILE_HOME_ENV];
  else process.env[INTERNAL_PROFILE_HOME_ENV] = previousProfileHome;
  await rm(profileHome, { recursive: true, force: true });
});

describe('RegistryPackageReader registry-type context', () => {
  it('requires gitTree for a public registry version', async () => {
    await writeRegistry('public', false);

    const result = await new RegistryPackageReader(shortId).readPackageManifest('no-tree');

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SCHEMA_INVALID');
  });

  it('allows a trusted private registry version to omit gitTree', async () => {
    await writeRegistry('private', false);

    const result = await new RegistryPackageReader(shortId).readPackageManifest('no-tree');

    expect(result.ok).toBe(true);
  });

  it('fails closed when the registry metadata file is absent', async () => {
    await writeRegistry('private', false);
    await rm(join(getRegistryRepoPath(shortId), '.uapkg', 'registry.meta.json'));

    const result = await new RegistryPackageReader(shortId).readPackageManifest('no-tree');

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SCHEMA_INVALID');
  });

  it('fails closed when present metadata has an unknown schema version', async () => {
    await writeRegistry('private', false, 2);

    const result = await new RegistryPackageReader(shortId).readPackageManifest('no-tree');

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('SCHEMA_INVALID');
  });
});

async function writeRegistry(
  registryType: 'public' | 'private',
  includeGitTree: boolean,
  schemaVersion = 1,
): Promise<void> {
  const repoPath = getRegistryRepoPath(shortId);
  const packagePath = join(repoPath, 'packages', 'n', 'no-tree.json');
  await mkdir(dirname(packagePath), { recursive: true });
  await mkdir(join(repoPath, '.uapkg'), { recursive: true });
  await writeFile(
    packagePath,
    JSON.stringify({
      name: 'no-tree',
      packageSource: { type: 'git', url: 'https://github.com/acme/no-tree' },
      versions: {
        '1.0.0': {
          ...(includeGitTree ? { gitTree: 'a'.repeat(40) } : {}),
          releaseFiles: {
            package: {
              url: 'https://example.test/no-tree.tgz',
              integrity: { hash: `sha256:${'b'.repeat(64)}`, size: 1 },
            },
          },
        },
      },
    }),
    'utf8',
  );
  await writeFile(
    join(repoPath, '.uapkg', 'registry.meta.json'),
    JSON.stringify({
      schemaVersion,
      registry: {
        id: '00000000-0000-4000-a000-000000000020',
        name: 'Test registry',
        normalizedName: 'test-registry',
        registryType,
        createdAt: 1_700_000_000,
      },
      owner: {
        kind: 'organization',
        id: '00000000-0000-4000-a000-000000000021',
        name: 'Test owner',
        normalizedName: 'test-owner',
      },
      sourceOfTruth: { type: 'uapkg-service', apiBaseUrl: 'https://api.uapkg.dev/v1' },
      generated: { generatedAt: 1_700_000_001, generatedBy: 'uapkg-registry-app' },
    }),
    'utf8',
  );
}
