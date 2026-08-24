import type { UAPKGLifecycleCommandName, UAPKGOutputFormat } from '../cli/UAPKGCommandLine.ts';
import type {
  RegistryRequestDetail,
  RegistryRequestStatus,
  RegistryRequestSummary,
} from '../control-plane/ControlPlaneTypes.ts';

const TERMINAL_STATUSES: ReadonlySet<RegistryRequestStatus> = new Set([
  'ready',
  'ready_superseded',
  'rejected',
  'operationally_failed',
]);
const SUCCESS_STATUSES: ReadonlySet<RegistryRequestStatus> = new Set(['ready', 'ready_superseded']);

export type RegistryRequestPresentation =
  | { readonly kind: 'publish' }
  | {
      readonly kind: 'lifecycle';
      readonly operation: UAPKGLifecycleCommandName;
      readonly packageName: string;
      readonly packageVersion: string;
    }
  | { readonly kind: 'status' };

export interface RegistryRequestTerminalFormatOptions {
  readonly detail: RegistryRequestDetail;
  readonly registryAlias: string;
  readonly outputFormat: UAPKGOutputFormat;
  readonly presentation: RegistryRequestPresentation;
  readonly registryRefreshWarning?: string;
}

export interface RegistryRequestTerminalOutput {
  readonly stdout: string;
  readonly stderr?: string;
}

/**
 * Formats the caller-visible terminal story consistently for publish,
 * lifecycle, and standalone request-status commands. The additive check and
 * failure fields have already been bounded by
 * `ControlPlaneClient.getRegistryRequestDetail` before reaching this boundary.
 */
export function formatRegistryRequestTerminal(
  options: RegistryRequestTerminalFormatOptions,
): RegistryRequestTerminalOutput {
  return options.outputFormat === 'json' ? formatJson(options) : formatText(options);
}

export function isRegistryRequestTerminalStatus(status: RegistryRequestStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isRegistryRequestSuccessStatus(status: RegistryRequestStatus): boolean {
  return SUCCESS_STATUSES.has(status);
}

function formatJson(options: RegistryRequestTerminalFormatOptions): RegistryRequestTerminalOutput {
  const { detail, presentation, registryAlias, registryRefreshWarning } = options;
  const { request } = detail;
  const diagnosticFields = {
    ...(detail.checks ? { checks: detail.checks } : {}),
    ...(detail.terminalFailure ? { terminalFailure: detail.terminalFailure } : {}),
  };
  let body: Readonly<Record<string, unknown>>;

  if (presentation.kind === 'lifecycle') {
    body = {
      ok: isRegistryRequestSuccessStatus(request.status),
      operation: presentation.operation,
      registry: registryAlias,
      requestId: request.id,
      status: request.status,
      ...diagnosticFields,
      ...(registryRefreshWarning ? { registryRefreshWarning } : {}),
    };
  } else {
    body = {
      ok: isRegistryRequestSuccessStatus(request.status) || !isRegistryRequestTerminalStatus(request.status),
      registry: registryAlias,
      request,
      ...diagnosticFields,
      ...(registryRefreshWarning ? { registryRefreshWarning } : {}),
    };
  }

  return { stdout: `${JSON.stringify(body)}\n` };
}

function formatText(options: RegistryRequestTerminalFormatOptions): RegistryRequestTerminalOutput {
  const { detail, presentation, registryRefreshWarning } = options;
  const lines = presentationLines(presentation, detail.request);
  appendDiagnosticLines(lines, detail);

  let stderr: string | undefined;
  if (registryRefreshWarning) {
    stderr =
      presentation.kind === 'publish'
        ? `Package publication succeeded, but the local registry refresh failed: ${registryRefreshWarning}\n`
        : `The operation succeeded, but the local registry refresh failed: ${registryRefreshWarning}\n`;
  }
  return { stdout: `${lines.join('\n')}\n`, ...(stderr ? { stderr } : {}) };
}

function presentationLines(presentation: RegistryRequestPresentation, request: RegistryRequestSummary): string[] {
  if (presentation.kind === 'publish') {
    const lines = [`Publishing request ${request.id}: ${request.status}.`];
    if (request.status === 'ready_superseded') {
      lines.push('The publication was accepted; a newer change to the same package is already projected.');
    }
    return lines;
  }
  if (presentation.kind === 'lifecycle') {
    return [
      `${presentation.operation} request ${request.id} for ${presentation.packageName}@${presentation.packageVersion}: ${request.status}.`,
    ];
  }

  const lines = [`Request: ${request.id}`, `Status: ${request.status}`];
  if (request.currentStep) lines.push(`Step: ${request.currentStep}`);
  if (request.payload?.packageName) {
    lines.push(
      `Package: ${request.payload.packageName}${request.payload.packageVersion ? `@${request.payload.packageVersion}` : ''}`,
    );
  }
  return lines;
}

function appendDiagnosticLines(lines: string[], detail: RegistryRequestDetail): void {
  const failedChecks = detail.checks?.filter((check) => check.conclusion === 'failure') ?? [];
  if (failedChecks.length > 0) {
    lines.push('Failed checks:');
    for (const check of failedChecks) {
      lines.push(`  ${check.checkId}: ${check.reasonCode ?? 'failure'}`);
    }
  }

  if (detail.terminalFailure) {
    lines.push(`Operational failure: ${detail.terminalFailure.reasonCode}.`);
    const { attempts, maxAttempts } = detail.terminalFailure;
    if (attempts !== undefined && maxAttempts !== undefined) {
      lines.push(`Retry attempts: ${attempts} of ${maxAttempts}.`);
    } else if (attempts !== undefined) {
      lines.push(`Retry attempts: ${attempts}.`);
    } else if (maxAttempts !== undefined) {
      lines.push(`Retry limit: ${maxAttempts} ${maxAttempts === 1 ? 'attempt' : 'attempts'}.`);
    }
  }
}
