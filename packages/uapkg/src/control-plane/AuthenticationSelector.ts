import isCI from 'is-ci';
import type { PromptService } from '../prompts/PromptService.js';
import type { AccountManager } from './AccountManager.js';
import type { ControlPlaneCredential } from './ControlPlaneClient.js';
import type { ControlPlaneAuthMode, RegistryTrust, UAPKGCliScope } from './ControlPlaneTypes.js';
import { GitHubActionsOidcCredentialProvider } from './GitHubActionsOidcCredentialProvider.js';

export interface SelectedAuthentication {
  readonly kind: 'oidc' | 'login' | 'gat';
  readonly credential: ControlPlaneCredential;
  readonly otp?: string;
}

export class AuthenticationSelector {
  public constructor(
    private readonly account: AccountManager,
    private readonly prompts: PromptService,
    private readonly oidc = new GitHubActionsOidcCredentialProvider(),
    private readonly isInteractive = () => Boolean(process.stdin.isTTY && process.stdout.isTTY && !isCI),
  ) {}

  public async select(
    mode: ControlPlaneAuthMode,
    trust: RegistryTrust,
    scopes: readonly UAPKGCliScope[],
    requireFreshOtp: boolean,
  ): Promise<SelectedAuthentication> {
    if (mode === 'oidc' || (mode === 'auto' && this.oidc.isAvailable())) {
      const accessToken = await this.oidc.exchange(trust);
      return { kind: 'oidc', credential: { kind: 'bearer', accessToken } };
    }

    if (mode === 'login' || (mode === 'auto' && (await this.account.hasGrant(trust)))) {
      if (requireFreshOtp) this.assertInteractiveFreshOtp();
      const access = await this.account.getAccessCredential(trust, scopes);
      return {
        kind: 'login',
        credential: access.credential,
        otp: requireFreshOtp ? await this.readOtp() : undefined,
      };
    }

    const environmentToken = process.env.UAPKG_TOKEN?.trim();
    if (mode === 'gat' || (mode === 'auto' && environmentToken)) {
      if (!this.isInteractive()) {
        throw new Error(
          'Human GAT authentication requires an attended TTY. Headless publishing must use a configured GitHub Actions OIDC trusted publisher.',
        );
      }
      const accessToken = environmentToken || (await this.prompts.secret('UAPKG granular access token')).trim();
      if (!accessToken) throw new Error('A granular access token is required.');
      return {
        kind: 'gat',
        credential: { kind: 'bearer', accessToken },
        otp: requireFreshOtp ? await this.readOtp() : undefined,
      };
    }

    throw new Error(
      [
        `No supported publishing credential is available for "${trust.alias}".`,
        '',
        `Run \`uapkg login --registry ${trust.alias}\` on a browser-capable workstation,`,
        'set UAPKG_TOKEN for an attended GAT publish, or configure GitHub Actions OIDC.',
      ].join('\n'),
    );
  }

  private async readOtp(): Promise<string> {
    this.assertInteractiveFreshOtp();
    const otp = (await this.prompts.secret('Current TOTP code')).trim();
    if (!/^[0-9]{6,10}$/.test(otp)) {
      throw new Error('A current numeric TOTP code is required for interactive publishing.');
    }
    return otp;
  }

  private assertInteractiveFreshOtp(): void {
    if (this.isInteractive()) return;
    throw new Error(
      'Fresh TOTP confirmation requires an attended TTY. Human publishing is not supported in headless environments.',
    );
  }
}
