import type {
  Diagnostic,
  PublishDiagnosticFact,
  PublishDiagnosticResource,
  PublishRequestFailedDiagnostic,
} from '@uapkg/diagnostics';
import type { FormatterMap } from '../../contracts/FormatterTypes.ts';

export const publishFactLabels: Record<PublishDiagnosticFact['kind'], string> = {
  package: 'Package',
  version: 'Version',
  registry: 'Registry',
  'credential-kind': 'Credential',
  'requested-owner': 'Requested UAPKG owner',
  'token-owner': 'Token owner',
  'allowed-owner': 'Allowed UAPKG owner',
  'actual-access-mode': 'Current access',
  'required-access-mode': 'Required access',
  repository: 'Repository',
  'requested-repository': 'Submitted repository',
  'trusted-repository': 'Trusted repository',
  'request-id': 'Request ID',
  'retry-after': 'Retry after',
  'missing-capability': 'Missing capability',
};

export function publishResourceLabel(resource: PublishDiagnosticResource): string {
  const label = resource.label?.trim();
  if (label) return label;
  return resource.kind === 'command' ? 'Command' : 'More information';
}

/**
 * Render a publish submission failure in problem → context → fix → resource
 * order. Values have already been validated by the publish error mapper.
 */
export function formatPublishRequestFailed(diagnostic: Diagnostic): string {
  const d = diagnostic as PublishRequestFailedDiagnostic;
  const tag = d.level.toUpperCase();
  const lines = [`[${tag} ${d.code}]: ${d.message}`];

  for (const fact of d.data.facts) {
    lines.push(`  ${publishFactLabels[fact.kind]}: ${fact.value}`);
  }
  if (d.data.serverCode !== undefined) lines.push(`  Server code: ${d.data.serverCode}`);
  if (d.data.status !== undefined) lines.push(`  HTTP status: ${d.data.status}`);
  if (d.hint) lines.push(`  → ${d.hint}`);

  for (const resource of d.data.resources) {
    const value = resource.kind === 'command' ? resource.command : resource.url;
    lines.push(`  ${publishResourceLabel(resource)}: ${value}`);
  }

  return lines.join('\n');
}

export const publishingFormatters: FormatterMap = {
  PUBLISH_REQUEST_FAILED: formatPublishRequestFailed,
};
