import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { AccountCommand, type AccountCommandOptions } from '../../src/commands/AccountCommand.js';

interface JsonEnvelope {
  readonly status: 'ok' | 'error';
  readonly command: string;
  readonly data: unknown;
  readonly diagnostics: readonly unknown[];
}

interface RootStub {
  readonly root: CompositionRoot;
  readonly envelopes: JsonEnvelope[];
}

const OWNER_USER_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_OWNER_ID = '55555555-5555-4555-8555-555555555555';
const REGISTRY_ID = '44444444-4444-4444-8444-444444444444';
const PACKAGE_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN_ID = '77777777-7777-4777-8777-777777777777';

function createRootStub(): RootStub {
  const envelopes: JsonEnvelope[] = [];
  const root = {
    json: {
      emit(envelope: JsonEnvelope) {
        envelopes.push(envelope);
      },
    },
  } as unknown as CompositionRoot;

  return {
    root,
    envelopes,
  };
}

function createCommand(root: CompositionRoot, options: Partial<AccountCommandOptions>): AccountCommand {
  return new AccountCommand(root, {
    action: 'status',
    outputFormat: 'json',
    tokenRegistryAccessMode: 'none',
    tokenRegistryIds: [],
    tokenPackageAccessMode: 'none',
    tokenPackageIds: [],
    tokenPermissions: [],
    ...options,
  });
}

describe('AccountCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('emits ACCOUNT_AUTH_REQUIRED when no bearer token is provided', async () => {
    const { root, envelopes } = createRootStub();

    const exitCode = await createCommand(root, {
      action: 'status',
    }).execute();

    expect(exitCode).toBe(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      command: 'account',
      data: {
        code: 'ACCOUNT_AUTH_REQUIRED',
        status: 401,
      },
    });
  });

  it('uses bearer auth for status bootstrap', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-bearer');
      expect(headers.get('cookie')).toBeNull();

      return new Response(
        JSON.stringify({
          ok: true,
          session: {
            actorType: 'token',
            actorId: 'user:test',
            accountState: 'active',
            securedAccount: true,
            canWrite: true,
          },
          capabilities: {
            canCreateApiTokens: true,
            canRevokeApiTokens: true,
            reasons: [],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'status',
      outputFormat: 'json',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
    }).execute();

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'ok',
      command: 'account',
      data: {
        action: 'status',
      },
    });
  });

  it('includes bearer auth guidance when token auth is invalid', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: 'TOKEN_INVALID',
            message: 'Provided API token is invalid.',
          },
        }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'status',
      outputFormat: 'json',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
    }).execute();

    expect(exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      command: 'account',
      data: {
        code: 'TOKEN_INVALID',
        status: 401,
        message: expect.stringContaining('UAPKG_ACCOUNT_BEARER_TOKEN'),
      },
    });
  });

  it('creates a resource-owner grant after capability preflight and includes exact required reads', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);

      if (url.endsWith('/v1/github-user-app/account/capabilities')) {
        expect(init?.method).toBe('GET');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-bearer');

        return new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
              freshAuth: {
                isFresh: true,
                status: 'fresh',
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      if (url.endsWith('/v1/account/api-tokens')) {
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-bearer');

        const body = JSON.parse(String(init?.body)) as {
          readonly name: string;
          readonly expiresInDays: number;
          readonly resourceOwnerOrganizationId: string;
          readonly registryAccess: unknown;
          readonly packageAccess: unknown;
          readonly permissions: string[];
          readonly justification: string;
        };
        expect(body).toEqual({
          name: 'ci-token',
          expiresInDays: 30,
          resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
          registryAccess: { mode: 'selected', resourceIds: [REGISTRY_ID] },
          packageAccess: { mode: 'all' },
          permissions: [
            'organization.read',
            'registry.read',
            'package.read',
            'registry.packages.moderate',
            'package.publish',
          ],
          justification: 'Publish approved releases from CI',
        });

        return new Response(
          JSON.stringify({
            ok: true,
            apiToken: {
              id: TOKEN_ID,
              ownerUserId: OWNER_USER_ID,
              name: 'ci-token',
              displayPrefix: 'uapkg_gat_01234567…',
              status: 'active',
              approvalStatus: 'pending',
              resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
              registryAccess: { mode: 'selected', resourceIds: [REGISTRY_ID] },
              packageAccess: { mode: 'all' },
              permissions: [
                'organization.read',
                'registry.read',
                'package.read',
                'registry.packages.moderate',
                'package.publish',
              ],
              createdAt: 1_700_000_000_000,
              requestedAt: 1_700_000_000_000,
              expiresAt: 1_702_592_000_000,
              requestJustification: 'Publish approved releases from CI',
              token: 'uapkg_gat_0123456789abcdef_secret',
            },
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        );
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      outputFormat: 'json',
      apiUrl: 'https://api.uapkg.dev/',
      bearerToken: 'test-bearer',
      tokenName: 'ci-token',
      tokenResourceOwnerOrganizationId: RESOURCE_OWNER_ID,
      tokenRegistryAccessMode: 'selected',
      tokenRegistryIds: [` ${REGISTRY_ID} `],
      tokenPackageAccessMode: 'all',
      tokenPackageIds: [],
      tokenPermissions: [' registry.packages.moderate ', 'package.publish', 'package.publish'],
      tokenExpiresInDays: 30,
      tokenJustification: ' Publish approved releases from CI ',
    }).execute();

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'ok',
      command: 'account',
      data: {
        action: 'token-create',
        apiToken: {
          id: TOKEN_ID,
          approvalStatus: 'pending',
          resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
          token: 'uapkg_gat_0123456789abcdef_secret',
        },
      },
    });
  });

  it('adds only organization.read when both resource access categories are disabled', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/v1/github-user-app/account/capabilities')) {
        return new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }

      expect(url).toBe('https://api.uapkg.dev/v1/account/api-tokens');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        registryAccess: { mode: 'none' },
        packageAccess: { mode: 'none' },
        permissions: ['organization.read'],
      });
      return new Response(
        JSON.stringify({
          ok: true,
          apiToken: {
            id: TOKEN_ID,
            ownerUserId: OWNER_USER_ID,
            name: 'organization-reader',
            displayPrefix: 'uapkg_gat_01234567…',
            status: 'active',
            approvalStatus: 'approved',
            resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
            registryAccess: { mode: 'none' },
            packageAccess: { mode: 'none' },
            permissions: ['organization.read'],
            createdAt: 1_700_000_000_000,
            requestedAt: 1_700_000_000_000,
            expiresAt: 1_702_592_000_000,
            token: 'uapkg_gat_0123456789abcdef_secret',
          },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenName: 'organization-reader',
      tokenResourceOwnerOrganizationId: RESOURCE_OWNER_ID,
      tokenExpiresInDays: 30,
    }).execute();

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(envelopes[0]).toMatchObject({ status: 'ok', data: { action: 'token-create' } });
  });

  it('rejects selected resource access without resource ids before creating the token', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenName: 'invalid-selected-token',
      tokenResourceOwnerOrganizationId: RESOURCE_OWNER_ID,
      tokenRegistryAccessMode: 'selected',
      tokenExpiresInDays: 30,
    }).execute();

    expect(exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      data: {
        code: 'ACCOUNT_API_TOKEN_RESOURCE_ACCESS_INVALID',
        status: 400,
      },
    });
  });

  it('rejects token lifetimes above 366 days before creating the token', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenName: 'too-long-lived-token',
      tokenResourceOwnerOrganizationId: RESOURCE_OWNER_ID,
      tokenExpiresInDays: 367,
    }).execute();

    expect(exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      data: {
        code: 'ACCOUNT_API_TOKEN_INPUT_INVALID',
        status: 400,
      },
    });
  });

  it('emits capability denial when token-create is blocked by fresh-auth policy', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          capabilities: {
            canCreateApiTokens: false,
            canRevokeApiTokens: true,
            reasons: ['FRESH_AUTH_REQUIRED'],
            freshAuth: {
              isFresh: false,
              status: 'expired',
            },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      bearerToken: 'test-bearer',
      tokenName: 'ci-token',
      tokenExpiresInDays: 30,
      outputFormat: 'json',
    }).execute();

    expect(exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      command: 'account',
      data: {
        code: 'FRESH_AUTH_REQUIRED',
        status: 403,
      },
    });
    expect(envelopes[0]?.data).toMatchObject({
      message: expect.stringContaining('fresh auth status: expired'),
    });
  });

  it('validates token-id for token-revoke after capability preflight', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          capabilities: {
            canCreateApiTokens: true,
            canRevokeApiTokens: true,
            reasons: [],
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-revoke',
      bearerToken: 'test-bearer',
      tokenId: '   ',
      outputFormat: 'json',
    }).execute();

    expect(exitCode).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'error',
      command: 'account',
      data: {
        code: 'ACCOUNT_API_TOKEN_QUERY_INVALID',
        status: 400,
      },
    });
  });

  it('revokes a token through the clean account API path', async () => {
    const { root, envelopes } = createRootStub();
    const requestedUrls: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (input, init) => {
        requestedUrls.push(`${String(init?.method)} ${String(input)}`);
        return new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      })
      .mockImplementationOnce(async (input, init) => {
        requestedUrls.push(`${String(init?.method)} ${String(input)}`);
        return new Response(null, { status: 204 });
      });
    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-revoke',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenId: TOKEN_ID,
    }).execute();

    expect(exitCode).toBe(0);
    expect(requestedUrls).toEqual([
      'GET https://api.uapkg.dev/v1/github-user-app/account/capabilities',
      `DELETE https://api.uapkg.dev/v1/account/api-tokens/${TOKEN_ID}`,
    ]);
    expect(envelopes[0]).toMatchObject({
      status: 'ok',
      data: { action: 'token-revoke', tokenId: TOKEN_ID, revoked: true },
    });
  });

  it('uses bearer header for token-list', async () => {
    const { root, envelopes } = createRootStub();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.uapkg.dev/v1/account/api-tokens');
      expect(init?.method).toBe('GET');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-bearer');
      expect(new Headers(init?.headers).get('cookie')).toBeNull();

      return new Response(
        JSON.stringify({
          ok: true,
          apiTokens: [
            {
              id: TOKEN_ID,
              ownerUserId: OWNER_USER_ID,
              name: 'ci-token',
              displayPrefix: 'uapkg_gat_01234567…',
              status: 'active',
              approvalStatus: 'approved',
              resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
              registryAccess: { mode: 'none' },
              packageAccess: { mode: 'selected', resourceIds: [PACKAGE_ID] },
              permissions: ['organization.read', 'package.read', 'package.publish'],
              createdAt: 1_700_000_000_000,
              requestedAt: 1_700_000_000_000,
              expiresAt: 1_702_592_000_000,
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-list',
      outputFormat: 'json',
      bearerToken: 'test-bearer',
    }).execute();

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'ok',
      command: 'account',
      data: {
        action: 'token-list',
        apiTokens: [
          {
            id: TOKEN_ID,
            resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
            packageAccess: { mode: 'selected', resourceIds: [PACKAGE_ID] },
          },
        ],
      },
    });
  });

  it('uses canonical account namespace routes and prints one-time token reveal text on token create', async () => {
    const { root, envelopes } = createRootStub();
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const requestedUrls: string[] = [];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (input, init) => {
        requestedUrls.push(`${String(init?.method)} ${String(input)}`);
        return new Response(
          JSON.stringify({
            ok: true,
            capabilities: {
              canCreateApiTokens: true,
              canRevokeApiTokens: true,
              reasons: [],
              freshAuth: {
                isFresh: true,
                status: 'fresh',
              },
            },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      })
      .mockImplementationOnce(async (input, init) => {
        requestedUrls.push(`${String(init?.method)} ${String(input)}`);
        return new Response(
          JSON.stringify({
            ok: true,
            apiToken: {
              id: TOKEN_ID,
              ownerUserId: OWNER_USER_ID,
              name: 'ci-token',
              displayPrefix: 'uapkg_gat_01234567…',
              status: 'active',
              approvalStatus: 'pending',
              resourceOwnerOrganizationId: RESOURCE_OWNER_ID,
              registryAccess: { mode: 'selected', resourceIds: [REGISTRY_ID] },
              packageAccess: { mode: 'all' },
              permissions: ['organization.read', 'registry.read', 'package.read', 'package.publish'],
              createdAt: 1_700_000_000_000,
              requestedAt: 1_700_000_000_000,
              expiresAt: 1_702_592_000_000,
              requestJustification: 'Publish approved releases from CI',
              token: 'uapkg_gat_0123456789abcdef_secret',
            },
          }),
          {
            status: 201,
            headers: { 'content-type': 'application/json' },
          },
        );
      });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await createCommand(root, {
      action: 'token-create',
      outputFormat: 'text',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenName: 'ci-token',
      tokenResourceOwnerOrganizationId: RESOURCE_OWNER_ID,
      tokenRegistryAccessMode: 'selected',
      tokenRegistryIds: [REGISTRY_ID],
      tokenPackageAccessMode: 'all',
      tokenPermissions: ['package.publish'],
      tokenExpiresInDays: 30,
      tokenJustification: 'Publish approved releases from CI',
    }).execute();

    const stdoutOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join('');
    const tokenMatches = stdoutOutput.match(/uapkg_gat_0123456789abcdef_secret/g) ?? [];

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toEqual([
      'GET https://api.uapkg.dev/v1/github-user-app/account/capabilities',
      'POST https://api.uapkg.dev/v1/account/api-tokens',
    ]);
    expect(tokenMatches).toHaveLength(1);
    expect(stdoutOutput).toContain(`Resource owner: ${RESOURCE_OWNER_ID}`);
    expect(stdoutOutput).toContain('Approval status: pending.');
    expect(stdoutOutput).toContain('cannot authorize actions until an organization token manager approves it');
    expect(stdoutOutput).toContain('Token secret (shown only once):');
    expect(envelopes).toHaveLength(0);
  });
});
