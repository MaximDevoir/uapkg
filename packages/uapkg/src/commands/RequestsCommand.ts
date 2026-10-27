import type { CompositionRoot } from '#cli/app/CompositionRoot.ts';
import type { UAPKGOutputFormat } from '#cli/cli/UAPKGCommandLine.ts';
import { describeControlPlaneError } from '#cli/control-plane/AccountManager.ts';
import { ControlPlaneClient } from '#cli/control-plane/ControlPlaneClient.ts';
import { RequestWatch } from '#cli/control-plane/RequestWatch.ts';
import {
  ControlPlaneError,
  type RegistryRequestDetail,
  type RegistryRequestStatus,
} from '#cli/control-plane/ControlPlaneTypes.ts';
import {
  formatRegistryRequestTerminal,
  isRegistryRequestSuccessStatus,
  isRegistryRequestTerminalStatus,
} from '#cli/reporting/RegistryRequestTerminalFormatter.ts';
import type { Command } from '#cli/commands/Command.ts';

export interface RequestsCommandOptions {
  readonly action: 'list' | 'status';
  readonly requestId?: string;
  readonly registry?: string;
  readonly status?: RegistryRequestStatus;
  readonly watch: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

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
      const requestId = this.options.requestId;
      let detail: RegistryRequestDetail;
      if (!this.options.watch) {
        detail = await client.getRegistryRequestDetail(authentication.credential, requestId);
      } else {
        const readRequest = async (signal: AbortSignal) => {
          try {
            return await client.getRegistryRequestDetail(authentication.credential, requestId, signal);
          } catch (error) {
            if (!(error instanceof ControlPlaneError) || error.status !== 401) throw error;
            this.root.accountManager.invalidateAccessCredentials(trust);
            authentication = await this.root.accountManager.getAccessCredential(trust, [
              'publishing.request.read.self',
            ]);
            return client.getRegistryRequestDetail(authentication.credential, requestId, signal);
          }
        };
        const watch = new RequestWatch();
        try {
          detail = await watch.read(readRequest);
          let lastStatus = '';
          while (!isRegistryRequestTerminalStatus(detail.request.status)) {
            if (this.options.outputFormat === 'text' && detail.request.status !== lastStatus) {
              process.stdout.write(
                `${detail.request.id}: ${detail.request.status}${detail.request.currentStep ? ` (${detail.request.currentStep})` : ''}\n`,
              );
              lastStatus = detail.request.status;
            }
            await watch.wait();
            detail = await watch.read(readRequest);
          }
        } finally {
          watch.dispose();
        }
      }
      this.printRequest(detail, trust.alias);
      return isRegistryRequestSuccessStatus(detail.request.status) ||
        !isRegistryRequestTerminalStatus(detail.request.status)
        ? 0
        : 1;
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

  private printRequest(detail: RegistryRequestDetail, registryAlias: string): void {
    const output = formatRegistryRequestTerminal({
      detail,
      registryAlias,
      outputFormat: this.options.outputFormat,
      presentation: { kind: 'status' },
    });
    process.stdout.write(output.stdout);
  }
}
