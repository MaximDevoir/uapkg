import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok } from '@uapkg/diagnostics';
import type { Manifest } from '@uapkg/package-manifest-schema';
import { getRegistryRepoPath } from '@uapkg/registry-core';
import { c as createTar } from 'tar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { PublishCommand, readTrustedRegistryType } from '../../src/commands/PublishCommand.js';
import { AuthenticationSelector } from '../../src/control-plane/AuthenticationSelector.js';
import { ControlPlaneClient } from '../../src/control-plane/ControlPlaneClient.js';
import { ControlPlaneError, type RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';
import { createGitHubActionsPublishIdempotencyKey } from '../../src/control-plane/PublishIdempotencyStore.js';

const cleanups: string[] = [];
let profileHome: string;

beforeEach(async () => {
  profileHome = await mkdtemp(join(tmpdir(), 'uapkg-publish-profile-'));
  cleanups.push(profileHome);
  vi.stubEnv('UAPKG_INTERNAL_CONFIG_CACHE_HOME', profileHome);
  await writeTrustedRegistryMeta('registry-cache', 'private');
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeArchive(manifest: Record<string, unknown>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uapkg-publish-archive-'));
  cleanups.push(dir);
  const contentRoot = join(dir, 'pack-root');
  await mkdir(contentRoot, { recursive: true });
  await writeFile(join(contentRoot, 'uapkg.json'), JSON.stringify(manifest), 'utf8');
  const archivePath = join(dir, 'package.tgz');
  await createTar({ gzip: true, file: archivePath, cwd: dir, portable: true }, ['pack-root']);
  return archivePath;
}

async function writeTrustedRegistryMeta(
  shortId: string,
  registryType: 'public' | 'private',
  schemaVersion = 1,
): Promise<void> {
  const metaDir = join(getRegistryRepoPath(shortId), '.uapkg');
  await mkdir(metaDir, { recursive: true });
  await writeFile(
    join(metaDir, 'registry.meta.json'),
    JSON.stringify({
      schemaVersion,
      registry: {
        id: '00000000-0000-4000-a000-000000000020',
        name: 'Official',
        normalizedName: 'official',
        registryType,
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
      futureOptional: true,
    }),
    'utf8',
  );
}

describe('trusted registry metadata for publishing', () => {
  it('rejects both an absent metadata file and an unsupported present version', async () => {
    await expect(readTrustedRegistryType('missing-meta')).rejects.toThrow('metadata is missing');

    await writeTrustedRegistryMeta('future-meta', 'private', 2);
    await expect(readTrustedRegistryType('future-meta')).rejects.toThrow('unsupported schema version');
  });

  it('reads the registry type through the shared metadata schema', async () => {
    await writeTrustedRegistryMeta('valid-meta', 'public');

    await expect(readTrustedRegistryType('valid-meta')).resolves.toBe('public');
  });
});

describe('PublishCommand (artifact-first)', () => {
  it('lets a private packaged manifest reach trusted registry resolution before any policy call', async () => {
    const resolveTrust = vi.fn(async () => {
      throw new Error('trusted registry policy reached');
    });
    const root = {
      cwd: process.cwd(),
      packageManifest: {
        readManifest: vi.fn(async () =>
          ok({
            name: 'private-package',
            version: '1.0.0',
            kind: 'plugin',
            private: true,
          } as Manifest),
        ),
      },
      registryTrustResolver: { resolve: resolveTrust },
    } as unknown as CompositionRoot;
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new PublishCommand(root, {
      auth: 'login',
      detach: true,
      outputFormat: 'text',
    });

    await expect(command.execute()).resolves.toBe(1);

    expect(resolveTrust).toHaveBeenCalledWith(undefined);
    const output = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(output).toContain('trusted registry policy reached');
  });

  it('requests only create capability for a detached publication', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    const select = vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
      otp: '123456',
    });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-detached',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = publishRoot(trust);
    const command = new PublishCommand(root, {
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'package.tgz',
      assetPath: archivePath,
      auth: 'login',
      detach: true,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(0);

    expect(select).toHaveBeenCalledWith('login', trust, ['publishing.request.create'], true);
  });

  it('submits archive-derived claims and observed integrity to the dedicated publish route', async () => {
    const trust = registryTrust();
    const manifest = {
      name: 'example',
      version: '1.2.3',
      kind: 'plugin',
      dependencies: { 'core-utils': '^1.0.0' },
    };
    const archivePath = await makeArchive(manifest);
    const archiveBytes = await readFile(archivePath);
    const expectedDigest = `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`;

    const forceRefresh = vi.fn(async () => undefined);
    const select = vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
      otp: '123456',
    });
    const submit = vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-ready',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(ControlPlaneClient.prototype, 'getRegistryRequestDetail').mockResolvedValue({
      request: {
        id: 'request-ready',
        registryId: trust.registryId,
        kind: 'publish',
        status: 'ready',
      },
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = publishRoot(trust, {
      registry: 'manifest-registry',
      owner: 'manifest-owner',
      repository: 'manifest/repository',
      asset: 'manifest.tgz',
    });
    Object.assign(root.registryTrustResolver, { forceRefresh });
    const command = new PublishCommand(root, {
      registry: 'cli-registry',
      owner: 'cli-owner',
      repository: 'cli/repository',
      tag: 'release-1.2.3',
      asset: 'cli.tgz',
      assetPath: archivePath,
      auth: 'login',
      detach: false,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(0);

    expect(root.registryTrustResolver.resolve).toHaveBeenCalledWith('cli-registry');
    expect(select).toHaveBeenCalledWith(
      'login',
      trust,
      ['publishing.request.create', 'publishing.request.read.self'],
      true,
    );
    expect(submit).toHaveBeenCalledWith(
      expect.anything(),
      'publish',
      {
        registryId: trust.registryId,
        ownerOrganizationName: 'cli-owner',
        payload: {
          packageName: 'example',
          packageVersion: '1.2.3',
          source: {
            type: 'github_release',
            repository: 'cli/repository',
            releaseTag: 'release-1.2.3',
            assetName: 'cli.tgz',
          },
          observedIntegrity: { sha256: expectedDigest, sizeBytes: archiveBytes.length },
          claims: {
            name: 'example',
            version: '1.2.3',
            private: false,
            dependencies: { 'core-utils': { version: '^1.0.0' } },
            devDependencies: {},
            peerDependencies: {},
          },
        },
      },
      { idempotencyKey: expect.any(String), otp: '123456' },
    );
    expect(forceRefresh).toHaveBeenCalledWith(trust);
  });

  it('watches a queued publish through rejection and returns the failed check', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
    });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-rejected',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(ControlPlaneClient.prototype, 'getRegistryRequestDetail')
      .mockResolvedValueOnce({
        request: {
          id: 'request-rejected',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'checking',
        },
      })
      .mockResolvedValueOnce({
        request: {
          id: 'request-rejected',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'rejected',
        },
        checks: [
          {
            checkId: 'publish.source-revalidation',
            executionState: 'completed',
            conclusion: 'failure',
            reasonCode: 'GITHUB_RELEASE_NOT_FOUND',
          },
        ],
      });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const execution = new PublishCommand(publishRoot(trust), {
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'package.tgz',
      assetPath: archivePath,
      auth: 'login',
      detach: false,
      outputFormat: 'json',
    }).execute();

    await expect(execution).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        ok: false,
        registry: trust.alias,
        request: {
          id: 'request-rejected',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'rejected',
        },
        checks: [
          {
            checkId: 'publish.source-revalidation',
            executionState: 'completed',
            conclusion: 'failure',
            reasonCode: 'GITHUB_RELEASE_NOT_FOUND',
          },
        ],
      })}\n`,
    );
  });

  it('reuses the persisted idempotency key for a retried identical submission', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
      otp: undefined,
    });
    const submit = vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-detached',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const options = {
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'package.tgz',
      assetPath: archivePath,
      auth: 'login' as const,
      detach: true,
      outputFormat: 'json' as const,
    };
    await expect(new PublishCommand(publishRoot(trust), options).execute()).resolves.toBe(0);
    await expect(new PublishCommand(publishRoot(trust), options).execute()).resolves.toBe(0);

    const firstKey = (submit.mock.calls[0]?.[3] as { idempotencyKey?: string }).idempotencyKey;
    const secondKey = (submit.mock.calls[1]?.[3] as { idempotencyKey?: string }).idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBe(firstKey);
  });

  it('derives a deterministic Actions idempotency key that excludes the run attempt', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_RUN_ID', '987654321');
    vi.stubEnv('GITHUB_JOB', 'publish');
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '1');
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    const archiveBytes = await readFile(archivePath);
    const artifactSha256 = `sha256:${createHash('sha256').update(archiveBytes).digest('hex')}`;
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'oidc',
      credential: { kind: 'bearer', accessToken: 'oidc-session' },
    });
    const submit = vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-detached',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const options = {
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'package.tgz',
      assetPath: archivePath,
      auth: 'oidc' as const,
      detach: true,
      outputFormat: 'json' as const,
    };

    await expect(new PublishCommand(publishRoot(trust), options).execute()).resolves.toBe(0);
    vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
    await expect(new PublishCommand(publishRoot(trust), options).execute()).resolves.toBe(0);

    const expected = createGitHubActionsPublishIdempotencyKey(
      {
        registryId: trust.registryId,
        packageName: 'example',
        packageVersion: '1.2.3',
        artifactSha256,
      },
      {
        GITHUB_RUN_ID: '987654321',
        GITHUB_JOB: 'publish',
        GITHUB_RUN_ATTEMPT: '999',
      },
    );
    const firstKey = (submit.mock.calls[0]?.[3] as { idempotencyKey?: string }).idempotencyKey;
    const rerunKey = (submit.mock.calls[1]?.[3] as { idempotencyKey?: string }).idempotencyKey;
    expect(firstKey).toBe(expected);
    expect(firstKey).toMatch(/^gha-[0-9a-f]{64}$/);
    expect(rerunKey).toBe(firstKey);
    expect(
      createGitHubActionsPublishIdempotencyKey(
        {
          registryId: trust.registryId,
          packageName: 'example',
          packageVersion: '1.2.3',
          artifactSha256: `sha256:${'f'.repeat(64)}`,
        },
        { GITHUB_RUN_ID: '987654321', GITHUB_JOB: 'publish' },
      ),
    ).not.toBe(firstKey);
  });

  it('reports a typed diagnostic when synchronous submission fails in text mode', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
    });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockRejectedValue(
      new ControlPlaneError(
        'UNSCOPED_PACKAGE_OWNER_REQUIRED',
        'Initial publication requires ownerOrganizationName.',
        400,
        { packageName: 'example' },
      ),
    );
    const reportOne = vi.fn();
    const root = publishRoot(trust);
    Object.assign(root, { diagnostics: { reportOne } });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      new PublishCommand(root, {
        repository: 'acme/example',
        assetPath: archivePath,
        auth: 'login',
        detach: true,
        outputFormat: 'text',
      }).execute(),
    ).resolves.toBe(1);

    expect(reportOne).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'PUBLISH_REQUEST_FAILED',
        message: expect.stringContaining('needs an owner organization'),
        data: expect.objectContaining({
          serverCode: 'UNSCOPED_PACKAGE_OWNER_REQUIRED',
          status: 400,
        }),
      }),
    );
    expect(stderr).not.toHaveBeenCalled();
  });

  it('preserves the existing JSON-mode submission failure path', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
    });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockRejectedValue(
      new ControlPlaneError('UNSCOPED_PACKAGE_OWNER_REQUIRED', 'Existing JSON failure output.', 400),
    );
    const reportOne = vi.fn();
    const root = publishRoot(trust);
    Object.assign(root, { diagnostics: { reportOne } });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      new PublishCommand(root, {
        repository: 'acme/example',
        assetPath: archivePath,
        auth: 'login',
        detach: true,
        outputFormat: 'json',
      }).execute(),
    ).resolves.toBe(1);

    expect(reportOne).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toBe(
      'Existing JSON failure output. (UNSCOPED_PACKAGE_OWNER_REQUIRED)\n',
    );
  });

  it('leaves status-polling failures on the existing outer error path', async () => {
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
    });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-polling',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(ControlPlaneClient.prototype, 'getRegistryRequestDetail').mockRejectedValue(
      new ControlPlaneError('REQUEST_STATUS_UNAVAILABLE', 'Status polling failed.', 503),
    );
    const reportOne = vi.fn();
    const root = publishRoot(trust);
    Object.assign(root, { diagnostics: { reportOne } });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await expect(
      new PublishCommand(root, {
        repository: 'acme/example',
        assetPath: archivePath,
        auth: 'login',
        detach: false,
        outputFormat: 'text',
      }).execute(),
    ).resolves.toBe(1);

    expect(reportOne).not.toHaveBeenCalled();
    expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toBe(
      'Status polling failed. (REQUEST_STATUS_UNAVAILABLE)\n',
    );
  });

  it('re-exchanges an expired OIDC session while reading request status', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_RUN_ID', '12345');
    vi.stubEnv('GITHUB_JOB', 'publish');
    const trust = registryTrust();
    const archivePath = await makeArchive({ name: 'example', version: '1.2.3', kind: 'plugin' });
    const select = vi
      .spyOn(AuthenticationSelector.prototype, 'select')
      .mockResolvedValueOnce({
        kind: 'oidc',
        credential: { kind: 'bearer', accessToken: 'oidc-session-one' },
      })
      .mockResolvedValueOnce({
        kind: 'oidc',
        credential: { kind: 'bearer', accessToken: 'oidc-session-two' },
      });
    vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-ready',
      status: 'queued',
      message: 'queued',
    });
    const getRequest = vi
      .spyOn(ControlPlaneClient.prototype, 'getRegistryRequestDetail')
      .mockRejectedValueOnce(new ControlPlaneError('OIDC_SESSION_EXPIRED', 'Session expired.', 401))
      .mockResolvedValueOnce({
        request: {
          id: 'request-ready',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'ready',
        },
      });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(
      new PublishCommand(publishRoot(trust), {
        repository: 'acme/example',
        tag: 'v1.2.3',
        asset: 'package.tgz',
        assetPath: archivePath,
        auth: 'oidc',
        detach: false,
        outputFormat: 'json',
      }).execute(),
    ).resolves.toBe(0);

    expect(select).toHaveBeenNthCalledWith(
      1,
      'oidc',
      trust,
      ['publishing.request.create', 'publishing.request.read.self'],
      true,
    );
    expect(select).toHaveBeenNthCalledWith(2, 'oidc', trust, ['publishing.request.read.self'], false);
    expect(getRequest).toHaveBeenNthCalledWith(1, { kind: 'bearer', accessToken: 'oidc-session-one' }, 'request-ready');
    expect(getRequest).toHaveBeenNthCalledWith(2, { kind: 'bearer', accessToken: 'oidc-session-two' }, 'request-ready');
  });
});

function registryTrust(): RegistryTrust {
  const registryId = '00000000-0000-4000-a000-000000000020';
  return {
    alias: 'official',
    registryId,
    registryName: 'Official',
    repositoryUrl: 'https://github.com/uapkg/registry.git',
    repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
    issuer: 'https://account.uapkg.dev/oauth',
    apiBaseUrl: 'https://api.uapkg.dev',
    resource: `https://api.uapkg.dev/v1/registries/${registryId}`,
    cacheShortId: 'registry-cache',
  };
}

function publishRoot(
  trust: RegistryTrust,
  publish?: {
    registry?: string;
    owner?: string;
    repository?: string;
    asset?: string;
  },
): CompositionRoot {
  return {
    cwd: process.cwd(),
    packageManifest: {
      readManifest: vi.fn(async () =>
        ok({
          name: 'example',
          version: '1.2.3',
          kind: 'plugin',
          publish,
        } as Manifest),
      ),
    },
    registryTrustResolver: {
      resolve: vi.fn(async () => trust),
      forceRefresh: vi.fn(async () => undefined),
    },
    accountManager: {},
  } as unknown as CompositionRoot;
}
