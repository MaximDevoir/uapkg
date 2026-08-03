import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat, UAPKGWhoamiField } from '../cli/UAPKGCommandLine.js';
import { controlPlaneDiagnosticForError, describeControlPlaneError } from '../control-plane/AccountManager.js';
import { ControlPlaneClient } from '../control-plane/ControlPlaneClient.js';
import type { Command } from './Command.js';

export interface WhoamiCommandOptions {
  readonly field?: UAPKGWhoamiField;
  readonly registry?: string;
  readonly outputFormat: UAPKGOutputFormat;
}

export interface WhoamiCommandData {
  readonly account: {
    readonly id: string;
    readonly username: string;
    readonly displayName: string;
  };
  readonly registry: {
    readonly id: string;
    readonly name: string;
    readonly alias: string;
  };
  readonly deviceName: string;
}

export interface WhoamiFieldData {
  readonly field: UAPKGWhoamiField;
  readonly value: string;
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
      if (self.registry.id !== trust.registryId || self.grant.id !== access.grant.grantId) {
        throw new Error('The control plane returned identity information for an unexpected registry grant.');
      }

      const data: WhoamiCommandData = {
        account: self.account,
        registry: { id: trust.registryId, name: trust.registryName, alias: trust.alias },
        deviceName: self.grant.deviceName,
      };

      if (this.options.field) {
        const fieldData: WhoamiFieldData = {
          field: this.options.field,
          value: selectedFieldValue(this.options.field, data),
        };
        if (this.options.outputFormat === 'json') {
          this.root.json.emitSuccess('whoami', fieldData);
        } else {
          process.stdout.write(`${fieldData.value}\n`);
        }
        return 0;
      }

      if (this.options.outputFormat === 'json') {
        this.root.json.emitSuccess('whoami', data);
      } else {
        process.stdout.write(`Username: ${data.account.username}\n`);
        process.stdout.write(`User ID: ${data.account.id}\n`);
        process.stdout.write(`Display Name: ${data.account.displayName}\n`);
        process.stdout.write(`Registry: ${data.registry.name}\n`);
        process.stdout.write(`Registry ID: ${data.registry.id}\n`);
        process.stdout.write(`Registry Alias: ${data.registry.alias}\n`);
        process.stdout.write(`Device: ${data.deviceName}\n`);
      }
      return 0;
    } catch (error) {
      if (this.options.outputFormat === 'json') {
        this.root.json.emitError('whoami', [controlPlaneDiagnosticForError(error, 'whoami')]);
      } else {
        process.stderr.write(`${describeControlPlaneError(error)}\n`);
      }
      return 1;
    }
  }
}

function selectedFieldValue(field: UAPKGWhoamiField, data: WhoamiCommandData): string {
  switch (field) {
    case 'username':
      return data.account.username;
    case 'user-id':
      return data.account.id;
    case 'registry':
      return data.registry.name;
    case 'registry-id':
      return data.registry.id;
    default:
      return field satisfies never;
  }
}
