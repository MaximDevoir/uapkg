import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { RequestsCommand } from '../../src/commands/RequestsCommand.js';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';

afterEach(() => {
  vi.useRealTimers();
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
          checks: [
            {
              checkId: 'publish.package-claims',
              executionState: 'completed',
              conclusion: 'failure',
              reasonCode: 'CLAIMS_IDENTITY_MISMATCH',
            },
          ],
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
        checks: [
          {
            checkId: 'publish.package-claims',
            executionState: 'completed',
            conclusion: 'failure',
            reasonCode: 'CLAIMS_IDENTITY_MISMATCH',
          },
        ],
      })}\n`,
    );
  });

  it('prints only failed check reasons in terminal text output', async () => {
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
          checks: [
            {
              checkId: 'publish.package-claims',
              executionState: 'completed',
              conclusion: 'success',
            },
            {
              checkId: 'publish.source-public-access',
              executionState: 'completed',
              conclusion: 'failure',
              reasonCode: 'SOURCE_REPOSITORY_PRIVATE',
            },
          ],
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

    await expect(
      new RequestsCommand(root, {
        action: 'status',
        requestId: 'request-failed',
        watch: false,
        outputFormat: 'text',
      }).execute(),
    ).resolves.toBe(1);

    const output = stdout.mock.calls.map(([value]) => String(value)).join('');
    expect(output).toBe(
      [
        'Request: request-failed',
        'Status: rejected',
        'Failed checks:',
        '  publish.source-public-access: SOURCE_REPOSITORY_PRIVATE',
        '',
      ].join('\n'),
    );
    expect(output).not.toContain('publish.package-claims');
  });

  it('watches through checking and exits unsuccessfully with the operational reason', async () => {
    vi.useFakeTimers();
    const trust = registryTrust();
    let reads = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        reads += 1;
        return Response.json(
          reads === 1
            ? {
                ok: true,
                request: {
                  id: 'request-operational-failure',
                  registryId: trust.registryId,
                  kind: 'publish',
                  status: 'checking',
                },
              }
            : {
                ok: true,
                request: {
                  id: 'request-operational-failure',
                  registryId: trust.registryId,
                  kind: 'publish',
                  status: 'operationally_failed',
                },
                terminalFailure: {
                  reasonCode: 'GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED',
                  attempts: 5,
                  maxAttempts: 5,
                },
              },
        );
      }),
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

    const execution = new RequestsCommand(root, {
      action: 'status',
      requestId: 'request-operational-failure',
      watch: true,
      outputFormat: 'json',
    }).execute();
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(execution).resolves.toBe(1);
    expect(stdout).toHaveBeenCalledWith(
      `${JSON.stringify({
        ok: false,
        registry: trust.alias,
        request: {
          id: 'request-operational-failure',
          registryId: trust.registryId,
          kind: 'publish',
          status: 'operationally_failed',
        },
        terminalFailure: {
          reasonCode: 'GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED',
          attempts: 5,
          maxAttempts: 5,
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
