import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import type { Command } from './Command.js';

export interface LogoutCommandOptions {
  readonly registry?: string;
  readonly localOnly: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

export class LogoutCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: LogoutCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const trust = await this.root.registryTrustResolver.resolve(this.options.registry);
      const result = await this.root.accountManager.logout(trust, this.options.localOnly);
      if (this.options.outputFormat === 'json') {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            registry: { alias: trust.alias, id: trust.registryId },
            removed: result === 'removed',
            serverRevoked: result === 'removed' && !this.options.localOnly,
          })}\n`,
        );
      } else if (result === 'not-logged-in') {
        process.stdout.write(`No saved login exists for "${trust.alias}".\n`);
      } else if (this.options.localOnly) {
        process.stdout.write(
          `Removed the local login for "${trust.alias}". The remote grant may remain active; revoke it from the account website.\n`,
        );
      } else {
        process.stdout.write(`Revoked and removed the saved login for "${trust.alias}".\n`);
      }
      return 0;
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }
}
