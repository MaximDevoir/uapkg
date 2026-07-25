import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { AccountCommand } from '../../src/commands/AccountCommand.js';
import fixtures from '../fixtures/account-api-contract-fixtures.json';

interface JsonEnvelope {
  readonly status: 'ok' | 'error';
  readonly command: string;
  readonly data: unknown;
  readonly diagnostics: readonly unknown[];
}

function createRoot() {
  const envelopes: JsonEnvelope[] = [];
  const root = {
    json: {
      emit(envelope: JsonEnvelope) {
        envelopes.push(envelope);
      },
    },
  } as unknown as CompositionRoot;

  return { root, envelopes };
}

describe('Account API Contract Parity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses canonical bootstrap shape for status via bearer auth', async () => {
    const { root, envelopes } = createRoot();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.uapkg.dev/v1/github-user-app/account/bootstrap?includeCapabilities=true');
      expect(init?.method).toBe('GET');

      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer test-bearer');
      expect(headers.get('cookie')).toBeNull();

      return new Response(JSON.stringify(fixtures.bootstrapWithCapabilities), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await new AccountCommand(root, {
      action: 'status',
      outputFormat: 'json',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenRegistryAccessMode: 'none',
      tokenRegistryIds: [],
      tokenPackageAccessMode: 'none',
      tokenPackageIds: [],
      tokenPermissions: [],
    }).execute();

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatchObject({
      status: 'ok',
      command: 'account',
      data: {
        action: 'status',
        session: fixtures.bootstrapWithCapabilities.session,
        capabilities: fixtures.bootstrapWithCapabilities.capabilities,
      },
    });
  });

  it('surfaces destructive-action freshness denial from canonical capabilities payload', async () => {
    const { root, envelopes } = createRoot();

    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.uapkg.dev/v1/github-user-app/account/capabilities');
      expect(init?.method).toBe('GET');

      return new Response(JSON.stringify(fixtures.capabilitiesExpired), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    const exitCode = await new AccountCommand(root, {
      action: 'token-create',
      outputFormat: 'json',
      apiUrl: 'https://api.uapkg.dev',
      bearerToken: 'test-bearer',
      tokenName: 'ci-token',
      tokenResourceOwnerOrganizationId: '55555555-5555-4555-8555-555555555555',
      tokenRegistryAccessMode: 'selected',
      tokenRegistryIds: ['44444444-4444-4444-8444-444444444444'],
      tokenPackageAccessMode: 'all',
      tokenPackageIds: [],
      tokenPermissions: ['package.publish'],
      tokenExpiresInDays: 30,
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
  });
});
