import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import { ControlPlaneClient } from '../control-plane/ControlPlaneClient.js';
import type { Command } from './Command.js';

export interface WhoamiCommandOptions {
  readonly registry?: string;
  readonly outputFormat: UAPKGOutputFormat;
}

export class WhoamiCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: WhoamiCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const trust = await this.root.registryTrustResolver.resolve(this.options.registry);
      const access = await this.root.accountManager.getAccessCredential(trust, ['identity.self.read']);
      const self = await new ControlPlaneClient(trust.apiBaseUrl).getSelf(access.credential);
      const account = self.account;
      if (this.options.outputFormat === 'json') {
        process.stdout.write(
          `${JSON.stringify({
            ok: true,
            registry: { alias: trust.alias, id: trust.registryId, name: trust.registryName },
            account,
            deviceName: access.grant.deviceName,
          })}\n`,
        );
      } else {
        process.stdout.write(`Account: ${account.username ?? account.displayName ?? account.email ?? account.id}\n`);
        process.stdout.write(`Registry: ${trust.registryName} (${trust.alias})\n`);
        process.stdout.write(`Device: ${access.grant.deviceName}\n`);
      }
      return 0;
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }
}
