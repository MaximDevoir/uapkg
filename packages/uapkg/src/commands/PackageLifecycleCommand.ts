import { randomUUID } from 'node:crypto';
import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGLifecycleCommandName, UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import { AuthenticationSelector } from '../control-plane/AuthenticationSelector.js';
import { ControlPlaneClient } from '../control-plane/ControlPlaneClient.js';
import {
  type ControlPlaneAuthMode,
  ControlPlaneError,
  type RegistryRequestStatus,
  type RegistryRequestSubmission,
} from '../control-plane/ControlPlaneTypes.js';
import { PublishIdempotencyStore } from '../control-plane/PublishIdempotencyStore.js';
import { InkPromptService } from '../prompts/InkPromptService.js';
import type { Command } from './Command.js';

const TERMINAL_STATUSES = new Set<RegistryRequestStatus>([
  'ready',
  'ready_superseded',
  'rejected',
  'operationally_failed',
]);
const SUCCESS_STATUSES = new Set<RegistryRequestStatus>(['ready', 'ready_superseded']);
const WATCH_TIMEOUT_MS = 30 * 60 * 1000;
const REASON_REQUIRED: ReadonlySet<UAPKGLifecycleCommandName> = new Set(['yank', 'unyank', 'unpublish', 'deprecate']);

export interface PackageLifecycleCommandOptions {
  readonly operation: UAPKGLifecycleCommandName;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly reason?: string;
  readonly registry?: string;
  readonly auth: ControlPlaneAuthMode;
  readonly detach: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

/**
 * Shared implementation of the five route-derived package lifecycle
 * operations (`uapkg yank|unyank|unpublish|deprecate|undeprecate`). Each
 * command posts to its dedicated submission route and watches the request
 * to readiness unless detached.
 */
export class PackageLifecycleCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: PackageLifecycleCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const { operation, packageName, packageVersion } = this.options;
      if (!packageName.trim() || !packageVersion.trim()) {
        throw new Error(`uapkg ${operation} requires a package name and an exact version.`);
      }
      const reason = this.options.reason?.trim();
      if (REASON_REQUIRED.has(operation) && !reason) {
        throw new Error(`uapkg ${operation} requires --reason describing why the version is changing state.`);
      }

      const trust = await this.root.registryTrustResolver.resolve(this.options.registry);
      const selector = new AuthenticationSelector(this.root.accountManager, new InkPromptService());
      const requestedScopes = this.options.detach
        ? (['publishing.request.create'] as const)
        : (['publishing.request.create', 'publishing.request.read.self'] as const);
      let authentication = await selector.select(this.options.auth, trust, requestedScopes, true);

      const submission: RegistryRequestSubmission = {
        registryId: trust.registryId,
        payload: {
          packageName: packageName.trim(),
          packageVersion: packageVersion.trim(),
          ...(reason ? { reason } : {}),
        },
      };

      const idempotencyStore = new PublishIdempotencyStore();
      const submissionDigest = PublishIdempotencyStore.submissionDigest(operation, submission);
      const idempotencyKey = idempotencyStore.getOrCreate(submissionDigest, () => randomUUID());

      const client = new ControlPlaneClient(trust.apiBaseUrl);
      const created = await client.submitRegistryRequest(authentication.credential, operation, submission, {
        idempotencyKey,
        otp: authentication.otp,
      });
      if (this.options.detach) {
        this.print(created.requestId, created.status, trust.alias, undefined);
        return 0;
      }

      let request = await client.getRegistryRequest(authentication.credential, created.requestId);
      let previousStatus = '';
      const deadline = Date.now() + WATCH_TIMEOUT_MS;
      while (!TERMINAL_STATUSES.has(request.status)) {
        if (Date.now() >= deadline) {
          throw new Error(
            `Timed out waiting for request ${request.id}. Check it with \`uapkg requests status ${request.id}\`.`,
          );
        }
        if (this.options.outputFormat === 'text' && request.status !== previousStatus) {
          process.stdout.write(
            `${request.id}: ${request.status}${request.currentStep ? ` (${request.currentStep})` : ''}\n`,
          );
          previousStatus = request.status;
        }
        await delay(2_000);
        try {
          request = await client.getRegistryRequest(authentication.credential, created.requestId);
        } catch (error) {
          if (!(error instanceof ControlPlaneError) || error.status !== 401) throw error;
          if (authentication.kind === 'gat') throw error;
          if (authentication.kind === 'login') {
            this.root.accountManager.invalidateAccessCredentials(trust);
          }
          authentication = await selector.select(authentication.kind, trust, ['publishing.request.read.self'], false);
          request = await client.getRegistryRequest(authentication.credential, created.requestId);
        }
      }

      idempotencyStore.clear(submissionDigest);

      if (SUCCESS_STATUSES.has(request.status)) {
        let refreshWarning: string | undefined;
        try {
          await this.root.registryTrustResolver.forceRefresh(trust);
        } catch (error) {
          refreshWarning = error instanceof Error ? error.message : String(error);
        }
        this.print(request.id, request.status, trust.alias, refreshWarning);
        return 0;
      }

      this.print(request.id, request.status, trust.alias, undefined);
      return 1;
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }

  private print(
    requestId: string,
    status: RegistryRequestStatus,
    registryAlias: string,
    refreshWarning?: string,
  ): void {
    if (this.options.outputFormat === 'json') {
      process.stdout.write(
        `${JSON.stringify({
          ok: this.options.detach || SUCCESS_STATUSES.has(status),
          operation: this.options.operation,
          registry: registryAlias,
          requestId,
          status,
          ...(refreshWarning ? { registryRefreshWarning: refreshWarning } : {}),
        })}\n`,
      );
      return;
    }
    process.stdout.write(
      `${this.options.operation} request ${requestId} for ${this.options.packageName}@${this.options.packageVersion}: ${status}.\n`,
    );
    if (refreshWarning) {
      process.stderr.write(`The operation succeeded, but the local registry refresh failed: ${refreshWarning}\n`);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
