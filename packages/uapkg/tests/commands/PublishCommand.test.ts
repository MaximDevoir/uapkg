import { ok } from '@uapkg/diagnostics';
import type { Manifest } from '@uapkg/package-manifest-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { PublishCommand } from '../../src/commands/PublishCommand.js';
import { AuthenticationSelector } from '../../src/control-plane/AuthenticationSelector.js';
import { ControlPlaneClient } from '../../src/control-plane/ControlPlaneClient.js';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PublishCommand registry policy boundary', () => {
  it('allows a private manifest to reach trusted registry and server policy resolution', async () => {
    const resolveTrust = vi.fn(async () => {
      throw new Error('trusted registry policy reached');
    });
    const root = {
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
    expect(output).not.toContain('marked private and cannot be published');
  });

  it('requests only create capability for a detached publication', async () => {
    const trust = registryTrust();
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
    const root = publishRoot(trust, true);
    const command = new PublishCommand(root, {
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'package.tgz',
      manifestPath: 'uapkg.json',
      auth: 'login',
      detach: true,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(0);

    expect(select).toHaveBeenCalledWith('login', trust, ['publishing.request.create'], true);
  });

  it('applies CLI-over-manifest precedence and forces a registry refresh after acceptance', async () => {
    const trust = registryTrust();
    const forceRefresh = vi.fn(async () => undefined);
    const select = vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
      otp: '123456',
    });
    const submit = vi.spyOn(ControlPlaneClient.prototype, 'submitRegistryRequest').mockResolvedValue({
      requestId: 'request-accepted',
      status: 'queued',
      message: 'queued',
    });
    vi.spyOn(ControlPlaneClient.prototype, 'getRegistryRequest').mockResolvedValue({
      id: 'request-accepted',
      registryId: trust.registryId,
      kind: 'publish_new_package',
      status: 'accepted',
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = publishRoot(trust, false, {
      registry: 'manifest-registry',
      owner: 'manifest-owner',
      repository: 'manifest/repository',
      asset: 'manifest.tgz',
      manifestPath: 'packages/manifest/uapkg.json',
    });
    Object.assign(root.registryTrustResolver, { forceRefresh });
    const command = new PublishCommand(root, {
      registry: 'cli-registry',
      owner: 'cli-owner',
      repository: 'cli/repository',
      tag: 'release-1.2.3',
      asset: 'cli.tgz',
      manifestPath: 'packages/cli/uapkg.json',
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
      {
        registryId: trust.registryId,
        kind: 'publish_new_package',
        ownerOrganizationName: 'cli-owner',
        payload: {
          packageName: 'example',
          packageVersion: '1.2.3',
          source: {
            type: 'github_release',
            repository: 'cli/repository',
            releaseTag: 'release-1.2.3',
            assetName: 'cli.tgz',
            pathToManifest: 'packages/cli/uapkg.json',
          },
        },
      },
      '123456',
    );
    expect(forceRefresh).toHaveBeenCalledWith(trust);
  });
});

function registryTrust(): RegistryTrust {
  const registryId = '00000000-0000-4000-a000-000000000020';
  return {
    alias: 'official',
    registryId,
    registryName: 'Official',
    registryIdentifier: 'official',
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
  packageExists: boolean,
  publish?: {
    registry?: string;
    owner?: string;
    repository?: string;
    asset?: string;
    manifestPath?: string;
  },
): CompositionRoot {
  return {
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
    registryCore: {
      getOrCreateRegistry: vi.fn(() =>
        ok({
          getPackageManifest: vi.fn(async () =>
            packageExists
              ? ok({ name: 'example' })
              : {
                  ok: false,
                  diagnostics: [{ code: 'PACKAGE_NOT_FOUND', message: 'not found' }],
                },
          ),
        }),
      ),
    },
    accountManager: {},
  } as unknown as CompositionRoot;
}
