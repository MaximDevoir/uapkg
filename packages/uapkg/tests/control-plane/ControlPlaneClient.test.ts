import * as oauth from 'oauth4webapi';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { describeControlPlaneError } from '../../src/control-plane/AccountManager.js';
import { ControlPlaneClient, type ControlPlaneCredential } from '../../src/control-plane/ControlPlaneClient.js';
import {
  ControlPlaneError,
  OAuthScopeInsufficientError,
  OAuthScopeUnsupportedError,
  UAPKG_CONTROL_PLANE_API,
  type UAPKGCliScope,
} from '../../src/control-plane/ControlPlaneTypes.js';

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ControlPlaneClient CLI login confirmation', () => {
  it('validates preparation and activation responses over DPoP', async () => {
    const grantId = '22222222-2222-4222-8222-222222222222';
    const predecessorGrantId = '11111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const requests: Array<{
      readonly url: string;
      readonly method: string;
      readonly authorization: string | null;
    }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: requestUrl(input),
          method: init?.method ?? 'GET',
          authorization: headers.get('authorization'),
        });
        expect(headers.get('dpop')).toBeTruthy();
        if (init?.method === 'GET') {
          return Response.json({
            ok: true,
            account: {
              id: '20000000-0000-4000-a000-000000000020',
              username: 'maxim',
              displayName: 'Maxim Devoir',
            },
            registry: { id: '00000000-0000-4000-a000-000000000020' },
            grant: {
              id: grantId,
              status: 'pending',
              deviceName: 'workstation',
              idleExpiresAt: new Date(now + 86_400_000).toISOString(),
              absoluteExpiresAt: new Date(now + 172_800_000).toISOString(),
              activationExpiresAt: new Date(now + 60_000).toISOString(),
              replacesGrantId: predecessorGrantId,
              scopes: ['identity.self.read'],
            },
          });
        }
        return Response.json({
          ok: true,
          grant: { id: grantId, status: 'active', replacesGrantId: predecessorGrantId },
        });
      }),
    );
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential();

    await expect(client.getCliLoginConfirmation(credential)).resolves.toMatchObject({
      grant: {
        id: grantId,
        status: 'pending',
        activationExpiresAt: expect.any(String),
        replacesGrantId: predecessorGrantId,
      },
    });
    await expect(client.confirmCliLogin(credential)).resolves.toEqual({
      id: grantId,
      status: 'active',
      replacesGrantId: predecessorGrantId,
    });

    expect(requests).toEqual([
      {
        url: `${UAPKG_CONTROL_PLANE_API}/v1/account/cli-login/confirmation`,
        method: 'GET',
        authorization: 'DPoP access-token',
      },
      {
        url: `${UAPKG_CONTROL_PLANE_API}/v1/account/cli-login/confirmation`,
        method: 'POST',
        authorization: 'DPoP access-token',
      },
    ]);
  });

  it('rejects a missing replacement binding and a non-active confirmation response', async () => {
    const grantId = '22222222-2222-4222-8222-222222222222';
    const now = Date.now();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return Response.json({
          ok: true,
          account: {
            id: '20000000-0000-4000-a000-000000000020',
            username: 'maxim',
            displayName: 'Maxim Devoir',
          },
          registry: { id: '00000000-0000-4000-a000-000000000020' },
          grant: {
            id: grantId,
            status: 'pending',
            deviceName: 'workstation',
            idleExpiresAt: new Date(now + 86_400_000).toISOString(),
            absoluteExpiresAt: new Date(now + 172_800_000).toISOString(),
            activationExpiresAt: new Date(now + 60_000).toISOString(),
            scopes: ['identity.self.read'],
          },
        });
      }
      return Response.json({
        ok: true,
        grant: { id: grantId, status: 'pending', replacesGrantId: null },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential();

    await expect(client.getCliLoginConfirmation(credential)).rejects.toMatchObject({
      code: 'CLI_LOGIN_CONFIRMATION_RESPONSE_INVALID',
    });
    await expect(client.confirmCliLogin(credential)).rejects.toMatchObject({
      code: 'CLI_LOGIN_CONFIRMATION_RESPONSE_INVALID',
    });
  });
});

describe('ControlPlaneClient account identity validation', () => {
  it.each([
    {
      name: 'missing canonical username',
      account: { id: '20000000-0000-4000-a000-000000000020', displayName: 'Maxim Devoir' },
    },
    {
      name: 'non-UUID account id',
      account: { id: 'account-1', username: 'maxim', displayName: 'Maxim Devoir' },
    },
  ])('rejects an account/self response with $name', async ({ account }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          account,
          registry: { id: '00000000-0000-4000-a000-000000000020' },
          grant: {
            id: '10000000-0000-4000-a000-000000000020',
            deviceName: 'workstation',
            idleExpiresAt: '2027-01-01T00:00:00.000Z',
            absoluteExpiresAt: '2027-06-01T00:00:00.000Z',
            scopes: ['identity.self.read'],
          },
        }),
      ),
    );

    await expect(
      new ControlPlaneClient(UAPKG_CONTROL_PLANE_API).getSelf({
        kind: 'bearer',
        accessToken: 'memory-only-token',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SELF_RESPONSE_INVALID' });
  });
});

describe('ControlPlaneClient request-scoped OTP transport', () => {
  it('sends x-uapkg-otp only on the selected mutation and never on status polling', async () => {
    const observed: Array<{ method: string; otp: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        observed.push({ method: init?.method ?? 'GET', otp: headers.get('x-uapkg-otp') });
        if (init?.method === 'POST') {
          return Response.json({
            ok: true,
            requestId: 'request-1',
            status: 'queued',
            message: 'queued',
          });
        }
        return Response.json({
          ok: true,
          request: {
            id: 'request-1',
            registryId: '00000000-0000-4000-a000-000000000020',
            kind: 'publish',
            status: 'ready',
          },
        });
      }),
    );
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = { kind: 'bearer', accessToken: 'memory-only-token' } as const;

    await client.submitRegistryRequest(
      credential,
      'publish',
      {
        registryId: '00000000-0000-4000-a000-000000000020',
        payload: { packageName: 'example', packageVersion: '1.0.0' },
      },
      { otp: '123456' },
    );
    await client.getRegistryRequest(credential, 'request-1');

    expect(observed).toEqual([
      { method: 'POST', otp: '123456' },
      { method: 'GET', otp: null },
    ]);
  });

  it('preserves the challenged action on a second-factor-required response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: {
              code: 'SECOND_FACTOR_REQUIRED',
              message: 'A TOTP code is required for this action (package.publish).',
              details: { action: 'package.publish' },
            },
          },
          { status: 403 },
        ),
      ),
    );
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);

    let failure: unknown;
    try {
      await client.submitRegistryRequest({ kind: 'bearer', accessToken: 'memory-only-token' }, 'publish', {
        registryId: '00000000-0000-4000-a000-000000000020',
        payload: { packageName: 'example', packageVersion: '1.0.0' },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ControlPlaneError);
    expect(failure).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
      message: 'A TOTP code is required for this action (package.publish).',
      status: 403,
      details: { action: 'package.publish' },
    });
  });
});

describe('ControlPlaneClient registry request detail', () => {
  const request = {
    id: 'request-1',
    registryId: '00000000-0000-4000-a000-000000000020',
    kind: 'publish',
    status: 'operationally_failed',
  } as const;
  const credential = { kind: 'bearer', accessToken: 'memory-only-token' } as const;

  it('parses bounded checks and sanitized terminal retry exhaustion details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          request,
          checks: [
            {
              checkId: 'publish.source-public-access',
              executionState: 'completed',
              conclusion: 'failure',
              reasonCode: 'SOURCE_REPOSITORY_PRIVATE',
              evidence: { credential: 'must-not-be-returned' },
            },
            {
              checkId: 'publish.source-revalidation',
              executionState: 'completed',
              conclusion: 'skipped',
              reasonCode: 'unavailable_in_private_registry',
            },
          ],
          terminalFailure: {
            reasonCode: 'GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED',
            attempts: 5,
            maxAttempts: 5,
            message: 'must-not-be-returned',
          },
        }),
      ),
    );

    const detail = await new ControlPlaneClient(UAPKG_CONTROL_PLANE_API).getRegistryRequestDetail(
      credential,
      request.id,
    );

    expect(detail).toEqual({
      request,
      checks: [
        {
          checkId: 'publish.source-public-access',
          executionState: 'completed',
          conclusion: 'failure',
          reasonCode: 'SOURCE_REPOSITORY_PRIVATE',
        },
        {
          checkId: 'publish.source-revalidation',
          executionState: 'completed',
          conclusion: 'skipped',
          reasonCode: 'unavailable_in_private_registry',
        },
      ],
      terminalFailure: {
        reasonCode: 'GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED',
        attempts: 5,
        maxAttempts: 5,
      },
    });
    expect(JSON.stringify(detail)).not.toContain('must-not-be-returned');
  });

  it('accepts the original summary-only response and preserves getRegistryRequest', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          request,
          // The summary-only method intentionally ignores additive fields,
          // including ones an older client does not understand.
          checks: 'future-or-malformed-detail',
        }),
      ),
    );
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);

    await expect(client.getRegistryRequest(credential, request.id)).resolves.toEqual(request);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ ok: true, request })),
    );
    await expect(client.getRegistryRequestDetail(credential, request.id)).resolves.toEqual({
      request,
    });
  });

  it.each([
    {
      name: 'more than 100 checks',
      response: {
        ok: true,
        request,
        checks: Array.from({ length: 101 }, (_, index) => ({
          checkId: `publish.check-${index}`,
          executionState: 'pending',
        })),
      },
    },
    {
      name: 'an oversized check identifier',
      response: {
        ok: true,
        request,
        checks: [{ checkId: 'x'.repeat(129), executionState: 'pending' }],
      },
    },
    {
      name: 'a control character in a displayed check identifier',
      response: {
        ok: true,
        request,
        checks: [{ checkId: 'publish.check\u001b[31m', executionState: 'pending' }],
      },
    },
    {
      name: 'an oversized check reason code',
      response: {
        ok: true,
        request,
        checks: [{ checkId: 'publish.check', executionState: 'completed', reasonCode: 'x'.repeat(129) }],
      },
    },
    {
      name: 'an invalid terminal reason code',
      response: {
        ok: true,
        request,
        terminalFailure: { reasonCode: 'not_safe_for_display', attempts: 5, maxAttempts: 5 },
      },
    },
    {
      name: 'a non-positive attempt count',
      response: {
        ok: true,
        request,
        terminalFailure: { reasonCode: 'RETRY_EXHAUSTED', attempts: 0 },
      },
    },
  ])('rejects $name', async ({ response }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );

    await expect(
      new ControlPlaneClient(UAPKG_CONTROL_PLANE_API).getRegistryRequestDetail(credential, request.id),
    ).rejects.toMatchObject({ code: 'REGISTRY_REQUEST_RESPONSE_INVALID' });
  });
});

describe('ControlPlaneClient OAuth scope challenges', () => {
  it('preserves a validated DPoP insufficient_scope challenge as a typed 403 without retrying', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: 'OAUTH_SCOPE_INSUFFICIENT',
            message: 'The access token is missing a required scope.',
            details: {
              requiredScopes: ['publishing.request.create', 'publishing.request.read.self', 'registry.administrator'],
              missingScopes: ['publishing.request.create', 'publishing.request.read.self'],
            },
          },
        },
        {
          status: 403,
          headers: {
            'www-authenticate':
              'DPoP error="insufficient_scope", scope="publishing.request.create publishing.request.read.self registry.administrator"',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential(['publishing.request.create', 'publishing.request.read.self']);

    let failure: unknown;
    try {
      await client.submitRegistryRequest(credential, 'publish', {
        registryId: '00000000-0000-4000-a000-000000000020',
        payload: {
          packageName: 'example',
          packageVersion: '1.0.0',
          source: {
            type: 'github_release',
            repository: 'acme/example',
            releaseTag: 'v1.0.0',
            assetName: 'package.tgz',
          },
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OAuthScopeInsufficientError);
    expect(failure).toMatchObject({
      code: 'OAUTH_SCOPE_INSUFFICIENT',
      status: 403,
      requiredScopes: ['publishing.request.create', 'publishing.request.read.self'],
      missingScopes: ['publishing.request.create', 'publishing.request.read.self'],
    });
    expect(describeControlPlaneError(failure)).toContain('`uapkg login --registry official --reauthorize`');
    expect(describeControlPlaneError(failure)).not.toContain('registry.administrator');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps mismatched or unrequested scope challenge data generic and preserves HTTP 403', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: 'OAUTH_SCOPE_INSUFFICIENT',
            message: 'The access token is missing a required scope.',
            details: {
              requiredScopes: ['publishing.request.create'],
              missingScopes: ['publishing.request.create'],
            },
          },
        },
        {
          status: 403,
          headers: {
            'www-authenticate': 'DPoP error="insufficient_scope", scope="identity.self.read"',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential(['identity.self.read']);

    let failure: unknown;
    try {
      await client.getSelf(credential);
    } catch (error) {
      failure = error;
    }

    expect(failure).not.toBeInstanceOf(OAuthScopeInsufficientError);
    expect(failure).toMatchObject({ code: 'OAUTH_SCOPE_INSUFFICIENT', status: 403 });
    expect(describeControlPlaneError(failure)).not.toContain('reauthorize');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires a CLI update for a consistent unknown scope without echoing it, retrying, or suggesting login', async () => {
    const unknownScope = 'server.new;$env:SECRET';
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: 'OAUTH_SCOPE_INSUFFICIENT',
            message: `Missing ${unknownScope}.`,
            details: {
              requiredScopes: [unknownScope],
              missingScopes: [unknownScope],
            },
          },
        },
        {
          status: 403,
          headers: {
            'www-authenticate': `DPoP error="insufficient_scope", scope="${unknownScope}"`,
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential(['identity.self.read']);

    let failure: unknown;
    try {
      await client.getSelf(credential);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(OAuthScopeUnsupportedError);
    expect(failure).toMatchObject({
      code: 'OAUTH_SCOPE_UNSUPPORTED',
      status: 403,
      reason: 'cli-update-required',
      unsupportedScopes: [],
    });
    const output = describeControlPlaneError(failure);
    expect(output).toContain('requires an OAuth capability that this UAPKG CLI version does not recognize');
    expect(output).toContain('Update UAPKG CLI and try again');
    expect(output).not.toContain(unknownScope);
    expect(output).not.toContain('reauthorize');
    expect(output).not.toContain('uapkg login');
    expect(JSON.stringify((failure as OAuthScopeUnsupportedError).details)).not.toContain(unknownScope);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

async function dpopCredential(
  requestedScopes: readonly UAPKGCliScope[] = ['identity.self.read'],
): Promise<ControlPlaneCredential> {
  const pair = await oauth.generateKeyPair('ES256');
  return {
    kind: 'dpop',
    accessToken: 'access-token',
    dpop: oauth.DPoP({}, pair),
    registryAlias: 'official',
    requestedScopes,
  };
}
