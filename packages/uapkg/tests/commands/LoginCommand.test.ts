import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { LoginCommand } from '../../src/commands/LoginCommand.js';
import { LoginError, type LoginOptions, type LoginResult } from '../../src/control-plane/AccountManager.js';
import type { RegistryGrantMetadata, RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';
import { JsonReporter } from '../../src/reporting/JsonReporter.js';

const trust: RegistryTrust = {
  alias: 'default',
  registryId: '00000000-0000-4000-a000-000000000020',
  registryName: 'Development Registry',
  repositoryUrl: 'https://github.com/uapkg/registry.git',
  repositoryFingerprint: `sha256:${'a'.repeat(64)}`,
  issuer: 'https://account-dev.uapkg.dev/oauth',
  apiBaseUrl: 'https://api-dev.uapkg.dev',
  resource: 'https://api-dev.uapkg.dev/v1/registries/00000000-0000-4000-a000-000000000020',
  cacheShortId: 'short-id',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoginCommand', () => {
  it('emits ordered progress and one canonical JSON success document', async () => {
    const jsonLines: string[] = [];
    const login = vi.fn(async (_trust: RegistryTrust, options: LoginOptions): Promise<LoginResult> => {
      options.onProgress?.({ type: 'preparing', registryAlias: trust.alias });
      options.onProgress?.({ type: 'opening-browser' });
      options.onProgress?.({ type: 'waiting-for-decision' });
      options.onProgress?.({ type: 'approval-received' });
      options.onProgress?.({ type: 'saving-local-credentials' });
      options.onProgress?.({ type: 'confirming-with-service' });
      return {
        grant: savedGrant(),
        warnings: ['The previous remote grant could not be revoked.'],
      };
    });
    const root = createRoot(login, jsonLines);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new LoginCommand(root, {
      registry: 'default',
      deviceName: 'workstation',
      reauthorize: true,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(0);

    expect(login).toHaveBeenCalledWith(
      trust,
      expect.objectContaining({
        deviceName: 'workstation',
        reauthorize: true,
        onProgress: expect.any(Function),
      }),
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(jsonLines).toHaveLength(1);
    expect(JSON.parse(jsonLines[0] ?? '')).toEqual({
      status: 'ok',
      command: 'login',
      data: {
        registry: { alias: trust.alias, id: trust.registryId, name: trust.registryName },
        account: savedGrant().account,
        deviceName: 'workstation',
        expiresAt: savedGrant().expiresAt,
        warnings: ['The previous remote grant could not be revoked.'],
      },
      diagnostics: [],
    });
    expect(stderr.mock.calls.map(([value]) => String(value)).join('')).toBe(
      [
        'Preparing browser authorization for "default"…',
        'Opening the UAPKG account page…',
        'Waiting for you to approve or deny access in the browser…',
        'Approval received. Verifying the account…',
        "Saving credentials in this device's protected credential store…",
        'Local credentials saved. Confirming the login with UAPKG…',
        'Warning: The previous remote grant could not be revoked.',
        '',
      ].join('\n'),
    );
  });

  it('emits a structured denial without leaking callback parameters or writing an error outside JSON', async () => {
    const jsonLines: string[] = [];
    const login = vi.fn(async (_trust: RegistryTrust, options: LoginOptions): Promise<LoginResult> => {
      options.onProgress?.({ type: 'preparing', registryAlias: trust.alias });
      options.onProgress?.({ type: 'opening-browser' });
      options.onProgress?.({ type: 'waiting-for-decision' });
      throw new LoginError(
        'LOGIN_ACCESS_DENIED',
        'Login denied: The user denied the registry grant. (access_denied)',
        'access_denied',
      );
    });
    const root = createRoot(login, jsonLines);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new LoginCommand(root, {
      reauthorize: true,
      outputFormat: 'json',
    });

    await expect(command.execute()).resolves.toBe(1);

    expect(stdout).not.toHaveBeenCalled();
    expect(jsonLines).toHaveLength(1);
    expect(JSON.parse(jsonLines[0] ?? '')).toEqual({
      status: 'error',
      command: 'login',
      diagnostics: [
        {
          level: 'error',
          code: 'LOGIN_ACCESS_DENIED',
          message: 'Login denied: The user denied the registry grant. (access_denied)',
          data: { oauthError: 'access_denied' },
        },
      ],
    });
    const stderrText = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(stderrText).toContain('Waiting for you to approve or deny access in the browser…');
    expect(stderrText).not.toContain('Login denied:');
    expect(JSON.stringify(jsonLines)).not.toContain('state=');
    expect(JSON.stringify(jsonLines)).not.toContain('/callback?');
  });

  it('prints a descriptive denial in text mode without printing an authorization URL', async () => {
    const login = vi.fn(async (_trust: RegistryTrust, options: LoginOptions): Promise<LoginResult> => {
      options.onProgress?.({ type: 'preparing', registryAlias: trust.alias });
      options.onProgress?.({ type: 'opening-browser' });
      options.onProgress?.({ type: 'waiting-for-decision' });
      throw new LoginError(
        'LOGIN_ACCESS_DENIED',
        'Login denied: The user denied the registry grant. (access_denied)',
        'access_denied',
      );
    });
    const root = createRoot(login);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new LoginCommand(root, { reauthorize: true, outputFormat: 'text' });

    await expect(command.execute()).resolves.toBe(1);

    const output = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(output).toContain('Opening the UAPKG account page…');
    expect(output).toContain('Login denied: The user denied the registry grant. (access_denied)');
    expect(output).not.toContain('https://');
  });

  it('prints the one-time authorization URL only after automatic browser launch fails', async () => {
    const authorizationUrl =
      'https://account-dev.uapkg.dev/oauth/auth?client_id=uapkg-cli&request_uri=urn%3Atest%3Aone-time';
    const login = vi.fn(async (_trust: RegistryTrust, options: LoginOptions): Promise<LoginResult> => {
      options.onProgress?.({ type: 'preparing', registryAlias: trust.alias });
      options.onProgress?.({ type: 'opening-browser' });
      options.onProgress?.({ type: 'browser-open-failed', authorizationUrl });
      options.onProgress?.({ type: 'waiting-for-decision' });
      throw new LoginError(
        'LOGIN_AUTHORIZATION_TIMEOUT',
        'Login timed out while waiting for browser authorization. Run `uapkg login --registry default` to try again.',
      );
    });
    const root = createRoot(login);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new LoginCommand(root, { reauthorize: false, outputFormat: 'text' });

    await expect(command.execute()).resolves.toBe(1);

    const output = stderr.mock.calls.map(([value]) => String(value)).join('');
    expect(output).toContain('Unable to open the browser automatically. Open this one-time URL to continue:');
    expect(output).toContain(authorizationUrl);
    expect(output.split(authorizationUrl)).toHaveLength(2);
    expect(output).not.toContain('LOGIN_AUTHORIZATION_TIMEOUT');
  });

  it('uses the personal username in text success output', async () => {
    const root = createRoot(vi.fn(async () => ({ grant: savedGrant(), warnings: [] })));
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const command = new LoginCommand(root, { reauthorize: false, outputFormat: 'text' });

    await expect(command.execute()).resolves.toBe(0);
    expect(stdout).toHaveBeenCalledWith('Logged in to "default" as maximdevoir+ts1 on workstation.\n');
  });
});

function createRoot(
  login: (trust: RegistryTrust, options: LoginOptions) => Promise<LoginResult>,
  jsonLines: string[] = [],
): CompositionRoot {
  return {
    registryTrustResolver: { resolve: vi.fn(async () => trust) },
    accountManager: { login },
    json: new JsonReporter({
      writeLine: (line) => {
        jsonLines.push(line);
      },
      write: () => undefined,
    }),
  } as unknown as CompositionRoot;
}

function savedGrant(): RegistryGrantMetadata {
  return {
    issuer: trust.issuer,
    registryId: trust.registryId,
    registryName: trust.registryName,
    grantId: 'grant-1',
    clientId: 'uapkg-cli',
    keyReference: 'dpop-key:grant-1',
    refreshTokenReference: 'grant:grant-1',
    publicKeyThumbprint: 'thumbprint',
    deviceName: 'workstation',
    repositoryFingerprint: trust.repositoryFingerprint,
    account: {
      id: '20000000-0000-4000-a000-000000000020',
      username: 'maximdevoir+ts1',
      displayName: 'Maxim Devoir',
    },
    createdAt: 1_700_000_000,
    idleExpiresAt: 1_700_086_400,
    expiresAt: 1_700_172_800,
  };
}
