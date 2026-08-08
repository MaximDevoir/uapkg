import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { PackageLifecycleCommand } from '../../src/commands/PackageLifecycleCommand.js';
import { AuthenticationSelector } from '../../src/control-plane/AuthenticationSelector.js';
import { type RegistryTrust, UAPKG_CONTROL_PLANE_API } from '../../src/control-plane/ControlPlaneTypes.js';
import { PublishIdempotencyStore } from '../../src/control-plane/PublishIdempotencyStore.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PackageLifecycleCommand request-scoped OTP', () => {
  it('sends the OTP only on submission and never on status polling or watch requests', async () => {
    vi.useFakeTimers();
    const trust = registryTrust();
    const select = vi.spyOn(AuthenticationSelector.prototype, 'select').mockResolvedValue({
      kind: 'login',
      credential: { kind: 'bearer', accessToken: 'memory-only-token' },
      otp: '123456',
    });
    vi.spyOn(PublishIdempotencyStore.prototype, 'getOrCreate').mockReturnValue('idempotency-key');
    vi.spyOn(PublishIdempotencyStore.prototype, 'clear').mockImplementation(() => undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const observed: Array<{
      readonly method: string;
      readonly path: string;
      readonly authorization: string | null;
      readonly otp: string | null;
    }> = [];
    let pollCount = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const method = init?.method ?? 'GET';
        observed.push({
          method,
          path: new URL(String(input)).pathname,
          authorization: headers.get('authorization'),
          otp: headers.get('x-uapkg-otp'),
        });
        if (method === 'POST') {
          return Response.json({
            ok: true,
            requestId: 'request-yank',
            status: 'queued',
            message: 'queued',
          });
        }
        pollCount += 1;
        return Response.json({
          ok: true,
          request: {
            id: 'request-yank',
            registryId: trust.registryId,
            kind: 'yank',
            status: pollCount === 1 ? 'checking' : 'ready',
          },
        });
      }),
    );
    const root = {
      registryTrustResolver: {
        resolve: vi.fn(async () => trust),
        forceRefresh: vi.fn(async () => undefined),
      },
      accountManager: {},
    } as unknown as CompositionRoot;
    const command = new PackageLifecycleCommand(root, {
      operation: 'yank',
      packageName: 'example',
      packageVersion: '1.2.3',
      reason: 'security response',
      auth: 'login',
      detach: false,
      outputFormat: 'json',
    });

    const execution = command.execute();
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(execution).resolves.toBe(0);

    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith(
      'login',
      trust,
      ['publishing.request.create', 'publishing.request.read.self'],
      true,
    );
    expect(observed).toEqual([
      {
        method: 'POST',
        path: '/v1/registry-requests/yank',
        authorization: 'Bearer memory-only-token',
        otp: '123456',
      },
      {
        method: 'GET',
        path: '/v1/registry-requests/request-yank',
        authorization: 'Bearer memory-only-token',
        otp: null,
      },
      {
        method: 'GET',
        path: '/v1/registry-requests/request-yank',
        authorization: 'Bearer memory-only-token',
        otp: null,
      },
    ]);
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
    apiBaseUrl: UAPKG_CONTROL_PLANE_API,
    resource: `${UAPKG_CONTROL_PLANE_API}/v1/registries/${registryId}`,
    cacheShortId: 'registry-cache',
  };
}
