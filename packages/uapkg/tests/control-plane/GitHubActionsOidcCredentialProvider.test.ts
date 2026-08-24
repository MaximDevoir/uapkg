import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.ts';
import { GitHubActionsOidcCredentialProvider } from '../../src/control-plane/GitHubActionsOidcCredentialProvider.ts';

const trust: RegistryTrust = {
  alias: 'official',
  registryId: '00000000-0000-4000-a000-000000000020',
  registryName: 'Official',
  repositoryUrl: 'https://github.com/uapkg/registry.git',
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  issuer: 'https://account.uapkg.dev/oauth',
  apiBaseUrl: 'https://api.uapkg.dev',
  resource: 'https://api.uapkg.dev/v1/registries/00000000-0000-4000-a000-000000000020',
  cacheShortId: 'registry-cache',
};
const target = { registryId: trust.registryId, packageName: 'example' };

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

beforeEach(() => {
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', 'https://vstoken.actions.githubusercontent.com/token?job=publish');
  vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'github-request-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GitHubActionsOidcCredentialProvider', () => {
  it('uses bounded, redirect-rejecting requests and the fixed audience', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ value: 'github-identity-secret' }))
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'uapkg-session-secret', expiresAt: 2_000_000_000 }));
    const provider = new GitHubActionsOidcCredentialProvider({ fetch: fetchMock, maxAttempts: 1 });

    await expect(provider.exchange(trust, target)).resolves.toBe('uapkg-session-secret');

    const githubRequest = fetchMock.mock.calls[0];
    expect(githubRequest?.[0] === undefined ? undefined : requestUrl(githubRequest[0])).toContain('audience=uapkg');
    expect(githubRequest?.[1]).toMatchObject({
      redirect: 'error',
      headers: { authorization: 'Bearer github-request-secret' },
      signal: expect.any(AbortSignal),
    });
    const exchangeRequest = fetchMock.mock.calls[1];
    expect(exchangeRequest?.[0] === undefined ? undefined : requestUrl(exchangeRequest[0])).toBe(
      'https://api.uapkg.dev/v1/oidc/github-actions/exchange',
    );
    expect(exchangeRequest?.[1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    const exchangeBody = exchangeRequest?.[1]?.body;
    const serializedExchangeBody =
      typeof exchangeBody === 'string'
        ? exchangeBody
        : exchangeBody instanceof URLSearchParams
          ? exchangeBody.toString()
          : undefined;
    expect(serializedExchangeBody).toBeDefined();
    expect(JSON.parse(serializedExchangeBody ?? 'null')).toEqual({
      provider: 'github_actions',
      audience: 'uapkg',
      idToken: 'github-identity-secret',
      target,
    });
  });

  it('honors bounded Retry-After delays for GitHub 429 and exchange 503 responses', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(Response.json({ value: 'github-identity-secret' }))
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'retry-after': '90' } }))
      .mockResolvedValueOnce(Response.json({ ok: true, token: 'uapkg-session-secret', expiresAt: 2_000_000_000 }));
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const provider = new GitHubActionsOidcCredentialProvider({
      fetch: fetchMock,
      sleep,
      maxAttempts: 2,
      maxRetryDelayMs: 5_000,
    });

    await expect(provider.exchange(trust, target)).resolves.toBe('uapkg-session-secret');

    expect(sleep.mock.calls).toEqual([[2_000], [5_000]]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('returns stable timeout diagnostics after the bounded retry budget', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    const provider = new GitHubActionsOidcCredentialProvider({ fetch: fetchMock, maxAttempts: 1 });

    await expect(provider.exchange(trust, target)).rejects.toMatchObject({
      code: 'OIDC_GITHUB_TOKEN_REQUEST_TIMEOUT',
      message: 'Timed out while requesting a GitHub Actions OIDC identity token.',
    });
  });

  it('rejects oversized JSON before accepting an identity token', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ value: 'x'.repeat(128) }));
    const provider = new GitHubActionsOidcCredentialProvider({
      fetch: fetchMock,
      maxAttempts: 1,
      maxResponseBytes: 32,
    });

    await expect(provider.exchange(trust, target)).rejects.toMatchObject({
      code: 'OIDC_GITHUB_TOKEN_RESPONSE_TOO_LARGE',
    });
  });

  it('rejects malformed UTF-8 JSON with a stable response error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Uint8Array([0x7b, 0x22, 0x76, 0x61, 0x6c, 0x75, 0x65, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const provider = new GitHubActionsOidcCredentialProvider({ fetch: fetchMock, maxAttempts: 1 });

    await expect(provider.exchange(trust, target)).rejects.toMatchObject({
      code: 'OIDC_GITHUB_TOKEN_RESPONSE_INVALID',
    });
  });

  it('preserves a validated control-plane error contract', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ value: 'github-identity-secret' }))
      .mockResolvedValueOnce(
        Response.json(
          {
            ok: false,
            error: {
              code: 'OIDC_IDENTITY_REJECTED',
              message: 'The workload identity was rejected.',
              details: { retryable: false },
            },
          },
          { status: 401 },
        ),
      );
    const provider = new GitHubActionsOidcCredentialProvider({ fetch: fetchMock, maxAttempts: 1 });

    await expect(provider.exchange(trust, target)).rejects.toMatchObject({
      code: 'OIDC_IDENTITY_REJECTED',
      message: 'The workload identity was rejected.',
      status: 401,
      details: { retryable: false },
    });
  });

  it('rejects a target that is missing or belongs to another registry before requesting a JWT', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new GitHubActionsOidcCredentialProvider({ fetch: fetchMock, maxAttempts: 1 });

    await expect(provider.exchange(trust, { registryId: 'different', packageName: 'example' })).rejects.toMatchObject({
      code: 'OIDC_EXCHANGE_TARGET_INVALID',
    });
    await expect(provider.exchange(trust, { registryId: trust.registryId, packageName: '   ' })).rejects.toMatchObject({
      code: 'OIDC_EXCHANGE_TARGET_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
