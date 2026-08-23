import { describe, expect, it } from 'vite-plus/test';
import {
  createPackageRegistryManifestSchema,
  getRegistryPackagePath,
  getRegistryPackagePathSegments,
  PackageRegistryManifestSchema,
  RegistryMetaSchema,
  RegistryVersionSchema,
} from '../src/index.js';

const versionRecord = {
  gitTree: 'a'.repeat(40),
  releaseFiles: {
    package: {
      url: 'https://example.com/releases/package.tgz',
      integrity: { hash: `sha256:${'b'.repeat(64)}`, size: 42 },
    },
  },
};

describe('RegistryVersionSchema', () => {
  it('defaults private to false for records predating the field', () => {
    const parsed = RegistryVersionSchema.parse(versionRecord);
    expect(parsed.private).toBe(false);
  });

  it('preserves an explicit private claim', () => {
    const parsed = RegistryVersionSchema.parse({ ...versionRecord, private: true });
    expect(parsed.private).toBe(true);
  });

  it('tolerates unknown optional members instead of rejecting them', () => {
    const parsed = RegistryVersionSchema.safeParse({
      ...versionRecord,
      futureOptional: { anything: 1 },
    });
    expect(parsed.success).toBe(true);
  });

  it('still rejects a missing release-files core', () => {
    const { releaseFiles: _releaseFiles, ...withoutRelease } = versionRecord;
    expect(RegistryVersionSchema.safeParse(withoutRelease).success).toBe(false);
  });
});

describe('PackageRegistryManifestSchema', () => {
  it('accepts scoped package names', () => {
    const parsed = PackageRegistryManifestSchema.safeParse({
      name: '@acme/tool',
      packageSource: { type: 'git', url: 'https://github.com/acme/tool' },
      versions: { '1.0.0': versionRecord },
    });
    expect(parsed.success).toBe(true);
  });

  it('allows private registry records to omit gitTree', () => {
    const withoutGitTree = {
      name: 'tool',
      packageSource: { type: 'git', url: 'https://github.com/acme/tool' },
      versions: {
        '1.0.0': { releaseFiles: versionRecord.releaseFiles },
      },
    };
    expect(createPackageRegistryManifestSchema('private').safeParse(withoutGitTree).success).toBe(true);
  });

  it('requires gitTree for every public registry version', () => {
    const withoutGitTree = {
      name: 'tool',
      packageSource: { type: 'git', url: 'https://github.com/acme/tool' },
      versions: {
        '1.0.0': { releaseFiles: versionRecord.releaseFiles },
      },
    };
    const parsed = createPackageRegistryManifestSchema('public').safeParse(withoutGitTree);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['versions', '1.0.0', 'gitTree']);
  });
});

describe('RegistryMetaSchema', () => {
  const meta = {
    schemaVersion: 1,
    registry: {
      id: '00000000-0000-4000-a000-000000000020',
      name: 'Official',
      normalizedName: 'official',
      registryType: 'public',
      createdAt: 1_700_000_000,
    },
    owner: {
      kind: 'organization',
      id: '00000000-0000-4000-a000-000000000021',
      name: 'UAPKG',
      normalizedName: 'uapkg',
    },
    sourceOfTruth: { type: 'uapkg-service', apiBaseUrl: 'https://api.uapkg.dev/v1' },
    generated: { generatedAt: 1_700_000_001, generatedBy: 'uapkg-registry-app' },
  } as const;

  it('accepts and preserves unknown optional members', () => {
    const parsed = RegistryMetaSchema.parse({
      ...meta,
      future: true,
      registry: { ...meta.registry, futureRegistryField: 'value' },
    });
    expect(parsed.future).toBe(true);
    expect(parsed.registry.futureRegistryField).toBe('value');
  });

  it('rejects unknown metadata schema versions', () => {
    expect(RegistryMetaSchema.safeParse({ ...meta, schemaVersion: 2 }).success).toBe(false);
  });
});

describe('registry package paths', () => {
  it('maps unscoped names to letter buckets', () => {
    expect(getRegistryPackagePath('core-utils')).toBe('packages/c/core-utils.json');
    expect(getRegistryPackagePathSegments('core-utils')).toEqual(['packages', 'c', 'core-utils.json']);
  });

  it('maps scoped names to scope directories', () => {
    expect(getRegistryPackagePath('@acme/tool')).toBe('packages/@acme/tool.json');
    expect(getRegistryPackagePathSegments('@acme/tool')).toEqual(['packages', '@acme', 'tool.json']);
  });
});
