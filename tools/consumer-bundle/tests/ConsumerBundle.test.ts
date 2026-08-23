import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  assertConsumerRootCompatibility,
  assertGitIdentityUnchanged,
  assertSourcePolicy,
  type BundlePackage,
  type ConsumerBundleManifestData,
  canonicalJson,
  computeBundleDigest,
  computeGitIdentity,
  createClosureBuildCommands,
  createContentAddressedFilename,
  type DependencyMap,
  normalizePackedTarball,
  publishBundle,
  readPackedManifest,
  resolveRuntimeClosure,
  selectConsumerRoots,
  validatePackedManifest,
  verifyBundleFiles,
  verifyCompletePackedClosure,
  type WorkspacePackage,
} from '../ConsumerBundle';

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function workspacePackage(
  name: string,
  dependencies: DependencyMap = {},
  optionalDependencies: DependencyMap = {},
): WorkspacePackage {
  return {
    name,
    version: '1.3.0',
    directory: `/workspace/${name}`,
    dependencies,
    optionalDependencies,
  };
}

function bundlePackage(name: string, dependencies: DependencyMap = {}): BundlePackage {
  const sha256 = 'a'.repeat(64);
  return {
    name,
    version: '1.3.0',
    file: createContentAddressedFilename(name, '1.3.0', sha256),
    sha256,
    dependencies,
    optionalDependencies: {},
  };
}

function minimalPackageTarball(manifest: object): Buffer {
  const body = Buffer.from(JSON.stringify(manifest, null, 2));
  const header = Buffer.alloc(512);
  header.write('package/package.json', 0, 'utf8');
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
  header[156] = '0'.charCodeAt(0);
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512), Buffer.alloc(1024)]));
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('runtime closure discovery', () => {
  it('discovers all recursive runtime dependencies in dependency-first order', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@uapkg/common-schema', workspacePackage('@uapkg/common-schema', { '@uapkg/diagnostics': 'workspace:^' })],
      ['@uapkg/diagnostics', workspacePackage('@uapkg/diagnostics')],
      [
        '@uapkg/package-claims',
        workspacePackage('@uapkg/package-claims', {
          '@uapkg/common-schema': 'workspace:^',
          '@uapkg/registry-schema': 'workspace:^',
        }),
      ],
      ['@uapkg/registry-schema', workspacePackage('@uapkg/registry-schema', { '@uapkg/diagnostics': 'workspace:^' })],
    ]);

    expect(resolveRuntimeClosure(packages, ['@uapkg/package-claims']).map((pkg) => pkg.name)).toEqual([
      '@uapkg/diagnostics',
      '@uapkg/common-schema',
      '@uapkg/registry-schema',
      '@uapkg/package-claims',
    ]);
  });

  it('routes CLI artifacts through the cache-aware production task', () => {
    const closure = [workspacePackage('@uapkg/common'), workspacePackage('@uapkg/cli')];

    expect(createClosureBuildCommands(closure)).toEqual([
      ['run', '--cache', '-w', 'pack:common'],
      ['run', '--cache', '-w', 'cli:build', '--', '--production'],
    ]);
  });

  it('includes optional internal dependencies and fails on a missing transitive package', () => {
    const packages = new Map<string, WorkspacePackage>([
      ['@uapkg/root', workspacePackage('@uapkg/root', {}, { '@uapkg/missing': 'workspace:^' })],
    ]);
    expect(() => resolveRuntimeClosure(packages, ['@uapkg/root'])).toThrow(
      'Internal runtime package @uapkg/missing is not present',
    );
  });

  it('selects declared consumer roots and rejects undeclared overrides', () => {
    const consumer = {
      dependencies: {
        '@uapkg/registry-schema': '^1.2.0',
        zod: '^4.0.0',
      },
      optionalDependencies: {
        '@uapkg/package-claims': '^1.2.0',
      },
    };
    expect(selectConsumerRoots(consumer)).toEqual(['@uapkg/package-claims', '@uapkg/registry-schema']);
    expect(selectConsumerRoots(consumer, ['@uapkg/registry-schema'])).toEqual(['@uapkg/registry-schema']);
    expect(() => selectConsumerRoots(consumer, ['@uapkg/common-schema'])).toThrow('is not a runtime dependency');
  });

  it('requires source root versions to satisfy the consumer npm contract', () => {
    const source = new Map([['@uapkg/registry-schema', workspacePackage('@uapkg/registry-schema')]]);
    expect(() =>
      assertConsumerRootCompatibility(
        { dependencies: { '@uapkg/registry-schema': '^1.2.0' } },
        ['@uapkg/registry-schema'],
        source,
      ),
    ).not.toThrow();

    source.set('@uapkg/registry-schema', {
      ...workspacePackage('@uapkg/registry-schema'),
      version: '2.0.0',
    });
    expect(() =>
      assertConsumerRootCompatibility(
        { dependencies: { '@uapkg/registry-schema': '^1.2.0' } },
        ['@uapkg/registry-schema'],
        source,
      ),
    ).toThrow('@uapkg/registry-schema@2.0.0 does not satisfy the consumer range ^1.2.0');
  });
});

describe('publish-shaped bundle identity', () => {
  const data: ConsumerBundleManifestData = {
    schemaVersion: 1,
    repository: 'MaximDevoir/uapkg',
    requestedRef: 'main',
    commit: '1'.repeat(40),
    dirty: false,
    dirtyContentDigest: null,
    consumer: {
      name: null,
      version: null,
      manifestSha256: '2'.repeat(64),
    },
    roots: ['@uapkg/registry-schema'],
    packages: [bundlePackage('@uapkg/registry-schema')],
  };

  it('canonicalizes keys and computes a deterministic aggregate digest', () => {
    expect(canonicalJson({ zebra: 1, alpha: { two: true, one: false } })).toBe(
      '{"alpha":{"one":false,"two":true},"zebra":1}',
    );
    expect(computeBundleDigest(data)).toBe(computeBundleDigest(structuredClone(data)));
    expect(computeBundleDigest({ ...data, requestedRef: 'feature/schema' })).not.toBe(computeBundleDigest(data));
  });

  it('uses the complete tarball digest in a safe content-addressed filename', () => {
    expect(createContentAddressedFilename('@uapkg/common-schema', '1.3.0', 'f'.repeat(64))).toBe(
      `uapkg-common-schema-1.3.0-${'f'.repeat(64)}.tgz`,
    );
  });

  it('normalizes publish manifests with different dependency iteration orders to identical tarballs', () => {
    const directory = temporaryDirectory('uapkg-bundle-determinism-');
    const first = path.join(directory, 'first.tgz');
    const second = path.join(directory, 'second.tgz');
    writeFileSync(
      first,
      minimalPackageTarball({
        name: '@uapkg/schema',
        version: '1.3.0',
        dependencies: { '@uapkg/diagnostics': '^1.3.0', '@uapkg/common-schema': '^1.3.0' },
      }),
    );
    writeFileSync(
      second,
      minimalPackageTarball({
        name: '@uapkg/schema',
        version: '1.3.0',
        dependencies: { '@uapkg/common-schema': '^1.3.0', '@uapkg/diagnostics': '^1.3.0' },
      }),
    );

    normalizePackedTarball(first);
    normalizePackedTarball(second);
    expect(readFileSync(first)).toEqual(readFileSync(second));
  });

  it('reads the packed manifest in-process without a platform archive command', () => {
    const directory = temporaryDirectory('uapkg-bundle-manifest-');
    const tarball = path.join(directory, 'common-schema.tgz');
    writeFileSync(
      tarball,
      minimalPackageTarball({
        name: '@uapkg/common-schema',
        version: '1.3.0',
        dependencies: { '@uapkg/diagnostics': '^1.3.0' },
      }),
    );

    const manifest = (() => {
      const originalPath = process.env.PATH;
      process.env.PATH = '';
      try {
        return readPackedManifest(tarball, {
          name: '@uapkg/common-schema',
          version: '1.3.0',
        });
      } finally {
        if (originalPath === undefined) {
          delete process.env.PATH;
        } else {
          process.env.PATH = originalPath;
        }
      }
    })();

    expect(manifest).toEqual({
      name: '@uapkg/common-schema',
      version: '1.3.0',
      dependencies: { '@uapkg/diagnostics': '^1.3.0' },
      optionalDependencies: {},
    });
  });

  it('rejects workspace ranges that were not rewritten by the Vite+ package manager', () => {
    expect(() =>
      validatePackedManifest(
        {
          name: '@uapkg/registry-schema',
          version: '1.3.0',
          dependencies: { '@uapkg/common-schema': 'workspace:^' },
        },
        { name: '@uapkg/registry-schema', version: '1.3.0' },
      ),
    ).toThrow('Vite+ package manager did not rewrite');

    expect(
      validatePackedManifest(
        {
          name: '@uapkg/registry-schema',
          version: '1.3.0',
          dependencies: { '@uapkg/common-schema': '^1.3.0' },
        },
        { name: '@uapkg/registry-schema', version: '1.3.0' },
      ).dependencies,
    ).toEqual({ '@uapkg/common-schema': '^1.3.0' });
  });

  it('fails if a packed transitive dependency is absent', () => {
    expect(() =>
      verifyCompletePackedClosure([bundlePackage('@uapkg/registry-schema', { '@uapkg/common-schema': '^1.3.0' })]),
    ).toThrow('Bundle is missing transitive runtime package @uapkg/common-schema');
  });

  it('detects missing and corrupted content-addressed tarballs', () => {
    const output = temporaryDirectory('uapkg-bundle-checksum-');
    const contents = Buffer.from('publish-shaped-tarball');
    const sha256 = createHash('sha256').update(contents).digest('hex');
    const pkg: BundlePackage = {
      ...bundlePackage('@uapkg/common-schema'),
      sha256,
      file: createContentAddressedFilename('@uapkg/common-schema', '1.3.0', sha256),
    };

    expect(() => verifyBundleFiles(output, [pkg])).toThrow('Bundle tarball is missing');
    writeFileSync(path.join(output, pkg.file), contents);
    expect(() => verifyBundleFiles(output, [pkg])).not.toThrow();
    writeFileSync(path.join(output, pkg.file), 'tampered');
    expect(() => verifyBundleFiles(output, [pkg])).toThrow('checksum mismatch');
  });

  it('removes stale tarballs when publishing a new exact bundle', () => {
    const temporary = temporaryDirectory('uapkg-bundle-publish-source-');
    const output = temporaryDirectory('uapkg-bundle-publish-output-');
    const contents = Buffer.from('current bundle package');
    const digest = createHash('sha256').update(contents).digest('hex');
    const pkg: BundlePackage = {
      ...bundlePackage('@uapkg/common-schema'),
      sha256: digest,
      file: createContentAddressedFilename('@uapkg/common-schema', '1.3.0', digest),
    };
    writeFileSync(path.join(temporary, pkg.file), contents);
    writeFileSync(path.join(output, 'stale-package.tgz'), 'stale');
    const manifestData: ConsumerBundleManifestData = { ...data, packages: [pkg] };
    const manifest = { ...manifestData, bundleDigest: computeBundleDigest(manifestData) };

    publishBundle(temporary, output, manifest);

    expect(readFileSync(path.join(output, pkg.file))).toEqual(contents);
    expect(() => readFileSync(path.join(output, 'stale-package.tgz'))).toThrow();
  });
});

describe('Git source identity', () => {
  it('is stable for unchanged dirty content and changes with tracked or untracked content', () => {
    const repository = temporaryDirectory('uapkg-bundle-git-');
    execFileSync('git', ['init'], { cwd: repository });
    execFileSync('git', ['config', 'user.email', 'bundle-test@example.invalid'], {
      cwd: repository,
    });
    execFileSync('git', ['config', 'user.name', 'Bundle Test'], { cwd: repository });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/MaximDevoir/uapkg.git'], {
      cwd: repository,
    });
    writeFileSync(path.join(repository, 'tracked.txt'), 'committed\n');
    execFileSync('git', ['add', 'tracked.txt'], { cwd: repository });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repository });

    const clean = computeGitIdentity(repository, 'MaximDevoir/uapkg');
    expect(clean.dirty).toBe(false);
    expect(clean.dirtyContentDigest).toBeNull();
    expect(() => assertSourcePolicy(clean, { ci: true, expectedCommit: clean.commit })).not.toThrow();

    writeFileSync(path.join(repository, 'tracked.txt'), 'changed\n');
    const trackedDirty = computeGitIdentity(repository, 'MaximDevoir/uapkg');
    expect(trackedDirty.dirty).toBe(true);
    expect(trackedDirty.dirtyContentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(computeGitIdentity(repository, 'MaximDevoir/uapkg').dirtyContentDigest).toBe(
      trackedDirty.dirtyContentDigest,
    );
    expect(() => assertSourcePolicy(trackedDirty, { ci: true, expectedCommit: trackedDirty.commit })).toThrow(
      'requires a clean',
    );

    writeFileSync(path.join(repository, 'untracked.txt'), 'new content\n');
    const untrackedDirty = computeGitIdentity(repository, 'MaximDevoir/uapkg');
    expect(untrackedDirty.dirtyContentDigest).not.toBe(trackedDirty.dirtyContentDigest);
    expect(() => assertSourcePolicy(clean, { ci: true, expectedCommit: 'not-a-sha' })).toThrow('40-character');
    expect(() => computeGitIdentity(repository, 'someone-else/uapkg')).toThrow(
      'Expected repository someone-else/uapkg',
    );
    expect(() => assertGitIdentityUnchanged(clean, trackedDirty)).toThrow('source identity changed');
    expect(() => assertGitIdentityUnchanged(trackedDirty, trackedDirty)).not.toThrow();
  }, 15_000);
});
