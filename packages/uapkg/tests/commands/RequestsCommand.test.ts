import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { RequestsCommand } from '../../src/commands/RequestsCommand.js';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RequestsCommand output', () => {
  it('marks a rejected terminal request as not ok in JSON and exits unsuccessfully', async () => {
    const trust = registryTrust();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          request: {
            id: 'request-failed',
            registryId: trust.registryId,
            kind: 'publish',
            status: 'rejected',
          },
        }),
      ),
    );
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = {
      registryTrustResolver: { resolve: vi.fn(async () => trust) },
      accountManager: {
        getAccessCredential: vi.fn(async () => ({
          credential: { kind: 'bearer', accessToken: 'memory-only-token' },
        })),
      },
    } as unknown as CompositionRoot;
    const command = new RequestsCommand(root, {
      action: 'status',
      requestId: 'request-failed',
      watch: false,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(1);

    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        ok: false,
        registry: trust.alias,
        request: {
          id: 'request-failed',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'rejected',
        },
      })}\n`,
    );
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
