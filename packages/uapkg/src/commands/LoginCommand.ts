import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import type { Command } from './Command.js';

export interface LoginCommandOptions {
  readonly registry?: string;
  readonly deviceName?: string;
  readonly reauthorize: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

export class LoginCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: LoginCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const trust = await this.root.registryTrustResolver.resolve(this.options.registry);
      const result = await this.root.accountManager.login(trust, {
        deviceName: this.options.deviceName,
        reauthorize: this.options.reauthorize,
      });
      if (this.options.outputFormat === 'json') {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            registry: { alias: trust.alias, id: trust.registryId, name: trust.registryName },
            account: result.grant.account,
            deviceName: result.grant.deviceName,
            expiresAt: result.grant.expiresAt,
            warnings: result.warnings,
          })}\n`,
        );
      } else {
        const account =
          result.grant.account?.username ??
          result.grant.account?.displayName ??
          result.grant.account?.email ??
          result.grant.account?.id ??
          'your account';
        process.stdout.write(`Logged in to "${trust.alias}" as ${account} on ${result.grant.deviceName}.\n`);
      }
      for (const warning of result.warnings) {
        process.stderr.write(`Warning: ${warning}\n`);
      }
      return 0;
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }
}
