import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import type { UAPKGWhoamiField } from '../../src/cli/UAPKGCommandLine.js';
import { WhoamiCommand } from '../../src/commands/WhoamiCommand.js';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';
import { JsonReporter } from '../../src/reporting/JsonReporter.js';

const ACCOUNT_ID = '20000000-0000-4000-a000-000000000020';
const REGISTRY_ID = '00000000-0000-4000-a000-000000000020';
const GRANT_ID = '10000000-0000-4000-a000-000000000020';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WhoamiCommand', () => {
  it('prints the complete live account and canonical registry context', async () => {
    stubIdentityResponse();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { root, getAccessCredential } = createRoot();

    await expect(new WhoamiCommand(root, { outputFormat: 'text' }).execute()).resolves.toBe(0);

    expect(getAccessCredential).toHaveBeenCalledWith(trust, ['identity.self.read']);
    expect(stdout.mock.calls.map(([value]) => String(value)).join('')).toBe(
      [
        'Username: maximdevoir+ts1',
        `User ID: ${ACCOUNT_ID}`,
        'Display Name: Maxim Devoir',
        'Registry: uapkg-registry-official',
        `Registry ID: ${REGISTRY_ID}`,
        'Registry Alias: default',
        'Device: live-workstation',
        '',
      ].join('\n'),
    );
  });

  it.each<[UAPKGWhoamiField, string]>([
    ['username', 'maximdevoir+ts1'],
    ['user-id', ACCOUNT_ID],
    ['registry', 'uapkg-registry-official'],
    ['registry-id', REGISTRY_ID],
  ])('prints only the selected %s value', async (field, expected) => {
    stubIdentityResponse();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const { root, resolveRegistry } = createRoot();

    await expect(new WhoamiCommand(root, { field, registry: 'default', outputFormat: 'text' }).execute()).resolves.toBe(
      0,
    );

    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(`${expected}\n`);
    expect(resolveRegistry).toHaveBeenCalledWith('default');
  });

  it('emits the canonical full JSON envelope', async () => {
    stubIdentityResponse();
    const jsonLines: string[] = [];
    const { root } = createRoot(jsonLines);

    await expect(new WhoamiCommand(root, { outputFormat: 'json' }).execute()).resolves.toBe(0);

    expect(jsonLines).toHaveLength(1);
    const result = JSON.parse(jsonLines[0]) as Record<string, unknown>;
    expect(result).toEqual({
      status: 'ok',
      command: 'whoami',
      data: {
        account: { id: ACCOUNT_ID, username: 'maximdevoir+ts1', displayName: 'Maxim Devoir' },
        registry: { id: REGISTRY_ID, name: 'uapkg-registry-official', alias: 'default' },
        deviceName: 'live-workstation',
      },
      diagnostics: [],
    });
    expect(result).not.toHaveProperty('ok');
  });

  it('emits one uniform JSON field payload', async () => {
    stubIdentityResponse();
    const jsonLines: string[] = [];
    const { root } = createRoot(jsonLines);

    await expect(new WhoamiCommand(root, { field: 'user-id', outputFormat: 'json' }).execute()).resolves.toBe(0);

    expect(JSON.parse(jsonLines[0])).toEqual({
      status: 'ok',
      command: 'whoami',
      data: { field: 'user-id', value: ACCOUNT_ID },
      diagnostics: [],
    });
  });

  it.each([
    ['registry', { registryId: '00000000-0000-4000-a000-000000000099' }],
    ['grant', { grantId: '10000000-0000-4000-a000-000000000099' }],
  ])('rejects a live identity bound to another %s without emitting data', async (_context, overrides) => {
    stubIdentityResponse(overrides);
    const jsonLines: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { root } = createRoot(jsonLines);

    await expect(new WhoamiCommand(root, { outputFormat: 'json' }).execute()).resolves.toBe(1);

    expect(jsonLines).toHaveLength(1);
    expect(JSON.parse(jsonLines[0])).toMatchObject({
      status: 'error',
      command: 'whoami',
      diagnostics: [
        {
          level: 'error',
          code: 'CONTROL_PLANE_COMMAND_FAILED',
          data: { operation: 'whoami' },
        },
      ],
    });
    expect(JSON.parse(jsonLines[0])).not.toHaveProperty('data');
    expect(stderr).not.toHaveBeenCalled();
  });
});

const trust: RegistryTrust = {
  alias: 'default',
  registryId: REGISTRY_ID,
  registryName: 'uapkg-registry-official',
  repositoryUrl: 'https://github.com/uapkg/registry-dev-tmp.git',
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  issuer: 'https://account.uapkg.dev/oauth',
  apiBaseUrl: 'https://api.uapkg.dev',
  resource: `https://api.uapkg.dev/v1/registries/${REGISTRY_ID}`,
  cacheShortId: 'registry-cache',
};

function createRoot(jsonLines: string[] = []): {
  root: CompositionRoot;
  getAccessCredential: ReturnType<typeof vi.fn>;
  resolveRegistry: ReturnType<typeof vi.fn>;
} {
  const getAccessCredential = vi.fn(async () => ({
    credential: { kind: 'bearer' as const, accessToken: 'memory-only-token' },
    grant: { grantId: GRANT_ID },
  }));
  const resolveRegistry = vi.fn(async () => trust);
  const root = {
    registryTrustResolver: { resolve: resolveRegistry },
    accountManager: { getAccessCredential },
    json: new JsonReporter({
      writeLine: (line) => jsonLines.push(line),
      write: () => undefined,
    }),
  } as unknown as CompositionRoot;
  return { root, getAccessCredential, resolveRegistry };
}

function stubIdentityResponse(overrides: { registryId?: string; grantId?: string } = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ok: true,
        account: { id: ACCOUNT_ID, username: 'maximdevoir+ts1', displayName: 'Maxim Devoir' },
        registry: { id: overrides.registryId ?? REGISTRY_ID },
        grant: {
          id: overrides.grantId ?? GRANT_ID,
          deviceName: 'live-workstation',
          idleExpiresAt: '2027-01-01T00:00:00.000Z',
          absoluteExpiresAt: '2027-06-01T00:00:00.000Z',
          scopes: ['identity.self.read'],
        },
      }),
    ),
  );
}
