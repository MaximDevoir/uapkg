import { describe, expect, it } from 'vitest';
import {
  getRegistryPackagePath,
  getRegistryPackagePathSegments,
  PackageRegistryManifestSchema,
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
    const parsed = RegistryVersionSchema.safeParse({ ...versionRecord, futureOptional: { anything: 1 } });
    expect(parsed.success).toBe(true);
  });

  it('still rejects a missing mandatory core', () => {
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
