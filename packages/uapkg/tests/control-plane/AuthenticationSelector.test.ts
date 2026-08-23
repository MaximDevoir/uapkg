import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AccountManager } from '../../src/control-plane/AccountManager.js';
import { AuthenticationSelector } from '../../src/control-plane/AuthenticationSelector.js';
import type { RegistryTrust } from '../../src/control-plane/ControlPlaneTypes.js';
import { GitHubActionsOidcCredentialProvider } from '../../src/control-plane/GitHubActionsOidcCredentialProvider.js';
import type { PromptService } from '../../src/prompts/PromptService.js';

const trust: RegistryTrust = {
  alias: 'official',
  registryId: 'registry-id',
  registryName: 'official',
  repositoryUrl: 'https://github.com/uapkg/registry',
  repositoryFingerprint: 'fingerprint',
  issuer: 'https://account.uapkg.dev/oauth',
  apiBaseUrl: 'https://api.uapkg.dev',
  resource: 'https://api.uapkg.dev/v1/registries/registry-id',
  cacheShortId: 'short-id',
};
const target = { registryId: trust.registryId, packageName: 'example' };

afterEach(() => {
  delete process.env.UAPKG_TOKEN;
  vi.unstubAllEnvs();
});

describe('AuthenticationSelector', () => {
  it('does not downgrade when detected OIDC authentication fails', async () => {
    const account = {
      hasGrant: vi.fn(async () => true),
      getAccessCredential: vi.fn(),
    };
    const oidc = {
      isAvailable: () => true,
      exchange: vi.fn(async () => {
        throw new Error('OIDC rejected');
      }),
    };
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompts(),
      oidc as unknown as GitHubActionsOidcCredentialProvider,
      () => true,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], false, target)).rejects.toThrow(
      'OIDC rejected',
    );
    expect(oidc.exchange).toHaveBeenCalledWith(trust, target);
    expect(account.hasGrant).not.toHaveBeenCalled();
  });

  it.each([
    ['the GitHub Actions runtime', 'GITHUB_ACTIONS', 'true'],
    ['an OIDC endpoint variable', 'ACTIONS_ID_TOKEN_REQUEST_URL', 'https://token.actions.githubusercontent.com'],
  ])('fails closed when %s is detected but id-token configuration is incomplete', async (_label, name, value) => {
    vi.stubEnv('GITHUB_ACTIONS', '');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_URL', '');
    vi.stubEnv('ACTIONS_ID_TOKEN_REQUEST_TOKEN', '');
    vi.stubEnv(name, value);
    const account = {
      hasGrant: vi.fn(async () => true),
      getAccessCredential: vi.fn(),
    };
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompts(),
      new GitHubActionsOidcCredentialProvider(),
      () => true,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], false, target)).rejects.toThrow(
      'identity-token endpoint is unavailable',
    );
    expect(account.hasGrant).not.toHaveBeenCalled();
  });

  it('does not downgrade a failed saved login to an environment GAT', async () => {
    process.env.UAPKG_TOKEN = 'uapkg_gat_test';
    const account = {
      hasGrant: vi.fn(async () => true),
      getAccessCredential: vi.fn(async () => {
        throw new Error('saved grant revoked');
      }),
    };
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompts(),
      { isAvailable: () => false } as GitHubActionsOidcCredentialProvider,
      () => true,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], false)).rejects.toThrow(
      'saved grant revoked',
    );
  });

  it('fails locally when OIDC is selected without an exact package target', async () => {
    const oidc = { isAvailable: () => true, exchange: vi.fn() };
    const selector = new AuthenticationSelector(
      { hasGrant: vi.fn(), getAccessCredential: vi.fn() } as unknown as AccountManager,
      prompts(),
      oidc as unknown as GitHubActionsOidcCredentialProvider,
      () => true,
    );

    await expect(selector.select('oidc', trust, ['publishing.request.create'], false)).rejects.toThrow(
      'requires a target package',
    );
    expect(oidc.exchange).not.toHaveBeenCalled();
  });

  it('uses an explicitly supplied environment GAT only after higher-priority modes are unavailable', async () => {
    process.env.UAPKG_TOKEN = 'uapkg_gat_test';
    const account = {
      hasGrant: vi.fn(async () => false),
      getAccessCredential: vi.fn(),
    };
    const prompt = prompts(['123456']);
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompt,
      { isAvailable: () => false } as GitHubActionsOidcCredentialProvider,
      () => true,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], true)).resolves.toEqual({
      kind: 'gat',
      credential: { kind: 'bearer', accessToken: 'uapkg_gat_test' },
      otp: '123456',
    });
    expect(prompt.secret).toHaveBeenCalledOnce();
  });

  it('rejects GAT use without an attended TTY even when the token is in the environment', async () => {
    process.env.UAPKG_TOKEN = 'uapkg_gat_test';
    const account = {
      hasGrant: vi.fn(async () => false),
      getAccessCredential: vi.fn(),
    };
    const prompt = prompts();
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompt,
      { isAvailable: () => false } as GitHubActionsOidcCredentialProvider,
      () => false,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], false)).rejects.toThrow(
      'requires an attended TTY',
    );
    expect(prompt.secret).not.toHaveBeenCalled();
  });

  it('rejects a saved-login publish before attempting a TOTP prompt without an attended TTY', async () => {
    const account = {
      hasGrant: vi.fn(async () => true),
      getAccessCredential: vi.fn(async () => ({
        credential: { kind: 'dpop', accessToken: 'access', dpop: {} },
      })),
    };
    const prompt = prompts();
    const selector = new AuthenticationSelector(
      account as unknown as AccountManager,
      prompt,
      { isAvailable: () => false } as GitHubActionsOidcCredentialProvider,
      () => false,
    );

    await expect(selector.select('auto', trust, ['publishing.request.create'], true)).rejects.toThrow(
      'Request-scoped TOTP confirmation requires an attended TTY',
    );
    expect(account.getAccessCredential).not.toHaveBeenCalled();
    expect(prompt.secret).not.toHaveBeenCalled();
  });

  it('rejects non-six-digit request OTPs before transport', async () => {
    process.env.UAPKG_TOKEN = 'uapkg_gat_test';
    const selector = new AuthenticationSelector(
      {
        hasGrant: vi.fn(async () => false),
        getAccessCredential: vi.fn(),
      } as unknown as AccountManager,
      prompts(['12345678']),
      { isAvailable: () => false } as GitHubActionsOidcCredentialProvider,
      () => true,
    );

    await expect(selector.select('gat', trust, ['publishing.request.create'], true)).rejects.toThrow(
      'A current 6-digit TOTP code is required for this publishing request.',
    );
  });
});

function prompts(secretValues: string[] = []): PromptService & { secret: ReturnType<typeof vi.fn> } {
  const secret = vi.fn(async () => secretValues.shift() ?? '');
  return {
    select: async (_message, _options, fallback) => fallback,
    text: async (_message, initial) => initial,
    secret,
  };
}
