import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { type LoginProgressEvent, loginDiagnosticForError } from '../control-plane/AccountManager.js';
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
        onProgress: (event) => this.reportProgress(event),
      });
      if (this.options.outputFormat === 'json') {
        this.root.json.emit({
          status: 'ok',
          command: 'login',
          data: {
            registry: { alias: trust.alias, id: trust.registryId, name: trust.registryName },
            account: result.grant.account,
            deviceName: result.grant.deviceName,
            expiresAt: result.grant.expiresAt,
            warnings: result.warnings,
          },
          diagnostics: [],
        });
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
      const diagnostic = loginDiagnosticForError(error);
      if (this.options.outputFormat === 'json') {
        this.root.json.emit({ status: 'error', command: 'login', diagnostics: [diagnostic] });
      } else {
        process.stderr.write(`${diagnostic.message}\n`);
      }
      return 1;
    }
  }

  private reportProgress(event: LoginProgressEvent): void {
    switch (event.type) {
      case 'preparing':
        process.stderr.write(`Preparing browser authorization for "${event.registryAlias}"…\n`);
        break;
      case 'opening-browser':
        process.stderr.write('Opening the UAPKG account page…\n');
        break;
      case 'browser-open-failed':
        process.stderr.write(
          `Unable to open the browser automatically. Open this one-time URL to continue:\n${event.authorizationUrl}\n`,
        );
        break;
      case 'waiting-for-decision':
        process.stderr.write('Waiting for you to approve or deny access in the browser…\n');
        break;
      case 'approval-received':
        process.stderr.write('Approval received. Verifying the account and saving the login…\n');
        break;
      default:
        event satisfies never;
    }
  }
}
