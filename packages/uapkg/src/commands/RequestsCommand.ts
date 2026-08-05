import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import { ControlPlaneClient } from '../control-plane/ControlPlaneClient.js';
import { ControlPlaneError, type RegistryRequestStatus } from '../control-plane/ControlPlaneTypes.js';
import type { Command } from './Command.js';

export interface RequestsCommandOptions {
  readonly action: 'list' | 'status';
  readonly requestId?: string;
  readonly registry?: string;
  readonly status?: RegistryRequestStatus;
  readonly watch: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

const TERMINAL_STATUSES = new Set<RegistryRequestStatus>([
  'ready',
  'ready_superseded',
  'rejected',
  'operationally_failed',
]);

export class RequestsCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: RequestsCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const trust = await this.root.registryTrustResolver.resolve(this.options.registry);
      let authentication = await this.root.accountManager.getAccessCredential(trust, ['publishing.request.read.self']);
      const client = new ControlPlaneClient(trust.apiBaseUrl);

      if (this.options.action === 'list') {
        const requests = await client.listRegistryRequests(
          authentication.credential,
          trust.registryId,
          this.options.status,
        );
        this.printList(requests, trust.alias);
        return 0;
      }

      if (!this.options.requestId) throw new Error('`uapkg requests status` requires a request ID.');
      let request = await client.getRegistryRequest(authentication.credential, this.options.requestId);
      if (this.options.watch) {
        let lastStatus = '';
        while (!TERMINAL_STATUSES.has(request.status)) {
          if (this.options.outputFormat === 'text' && request.status !== lastStatus) {
            process.stdout.write(
              `${request.id}: ${request.status}${request.currentStep ? ` (${request.currentStep})` : ''}\n`,
            );
            lastStatus = request.status;
          }
          await delay(2_000);
          try {
            request = await client.getRegistryRequest(authentication.credential, this.options.requestId);
          } catch (error) {
            if (!(error instanceof ControlPlaneError) || error.status !== 401) throw error;
            this.root.accountManager.invalidateAccessCredentials(trust);
            authentication = await this.root.accountManager.getAccessCredential(trust, [
              'publishing.request.read.self',
            ]);
            request = await client.getRegistryRequest(authentication.credential, this.options.requestId);
          }
        }
      }
      this.printRequest(request, trust.alias);
      return isSuccessStatus(request.status) || !TERMINAL_STATUSES.has(request.status) ? 0 : 1;
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }

  private printList(requests: readonly unknown[], registryAlias: string): void {
    if (this.options.outputFormat === 'json') {
      process.stdout.write(`${JSON.stringify({ ok: true, registry: registryAlias, requests })}\n`);
      return;
    }
    if (requests.length === 0) {
      process.stdout.write(`No publishing requests found for "${registryAlias}".\n`);
      return;
    }
    for (const value of requests as Array<{
      id: string;
      status: string;
      kind: string;
      payload?: { packageName?: string; packageVersion?: string };
    }>) {
      const packageCoordinate = value.payload?.packageName
        ? ` ${value.payload.packageName}${value.payload.packageVersion ? `@${value.payload.packageVersion}` : ''}`
        : '';
      process.stdout.write(`${value.id} ${value.status} ${value.kind}${packageCoordinate}\n`);
    }
  }

  private printRequest(request: unknown, registryAlias: string): void {
    const value = request as {
      id: string;
      status: RegistryRequestStatus;
      currentStep?: string;
      payload?: { packageName?: string; packageVersion?: string };
    };
    if (this.options.outputFormat === 'json') {
      const ok = isSuccessStatus(value.status) || !TERMINAL_STATUSES.has(value.status);
      process.stdout.write(`${JSON.stringify({ ok, registry: registryAlias, request })}\n`);
      return;
    }
    process.stdout.write(`Request: ${value.id}\n`);
    process.stdout.write(`Status: ${value.status}\n`);
    if (value.currentStep) process.stdout.write(`Step: ${value.currentStep}\n`);
    if (value.payload?.packageName) {
      process.stdout.write(
        `Package: ${value.payload.packageName}${value.payload.packageVersion ? `@${value.payload.packageVersion}` : ''}\n`,
      );
    }
  }
}

function isSuccessStatus(status: RegistryRequestStatus): boolean {
  return status === 'ready' || status === 'ready_superseded';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
