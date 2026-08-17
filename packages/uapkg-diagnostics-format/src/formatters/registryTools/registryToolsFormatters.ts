import type {
  Diagnostic,
  RegistryToolsDependencyNotInRegistryDiagnostic,
  RegistryToolsDependencyRangeUnreachableDiagnostic,
  RegistryToolsExternalRegistryDeniedDiagnostic,
  RegistryToolsExternalRegistryNotAllowedDiagnostic,
  RegistryToolsIntegrityMismatchDiagnostic,
  RegistryToolsOfficialPolicyViolationDiagnostic,
  RegistryToolsPackageMissingDiagnostic,
  RegistryToolsPackageSourceMismatchDiagnostic,
  RegistryToolsPathMismatchDiagnostic,
  RegistryToolsReleaseFileNameInvalidDiagnostic,
  RegistryToolsRemovalDeniedDiagnostic,
  RegistryToolsUnknownKeyDiagnostic,
  RegistryToolsVersionExistsDiagnostic,
  RegistryToolsVersionNotFoundDiagnostic,
  RegistryToolsVersionsUnsortedDiagnostic,
} from '@uapkg/diagnostics';
import type { FormatterMap } from '../../contracts/FormatterTypes.js';

function header(diagnostic: Diagnostic): string {
  return `[${diagnostic.level.toUpperCase()} ${diagnostic.code}]: ${diagnostic.message}`;
}

function withHint(lines: string[], diagnostic: Diagnostic): string {
  if (diagnostic.hint) lines.push(`  → ${diagnostic.hint}`);
  return lines.join('\n');
}

function formatPathMismatch(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsPathMismatchDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Package : ${data.packageName}`,
      `  Expected: ${data.expectedPath}`,
      `  Actual  : ${data.actualPath}`,
    ],
    diagnostic,
  );
}

function formatPackageSourceMismatch(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsPackageSourceMismatchDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Package  : ${data.packageName}`,
      `  Existing : ${data.existing.type}:${data.existing.url}`,
      `  Requested: ${data.requested.type}:${data.requested.url}`,
    ],
    diagnostic,
  );
}

function formatVersionExists(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsVersionExistsDiagnostic).data;
  return withHint([header(diagnostic), `  Package: ${data.packageName}`, `  Version: ${data.version}`], diagnostic);
}

function formatVersionNotFound(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsVersionNotFoundDiagnostic).data;
  return withHint([header(diagnostic), `  Package: ${data.packageName}`, `  Version: ${data.version}`], diagnostic);
}

function formatPackageMissing(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsPackageMissingDiagnostic).data;
  return withHint(
    [header(diagnostic), `  Package : ${data.packageName}`, `  Manifest: ${data.manifestPath}`],
    diagnostic,
  );
}

function formatVersionsUnsorted(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsVersionsUnsortedDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Package : ${data.packageName}`,
      `  Actual  : ${data.actual.join(', ')}`,
      `  Expected: ${data.expected.join(', ')}`,
    ],
    diagnostic,
  );
}

function formatExternalRegistryDenied(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsExternalRegistryDeniedDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Bucket     : ${data.bucket}`,
      `  Dependency : ${data.dependency}`,
      `  Registry   : ${data.registryName}`,
    ],
    diagnostic,
  );
}

function formatExternalRegistryNotAllowed(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsExternalRegistryNotAllowedDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Bucket     : ${data.bucket}`,
      `  Dependency : ${data.dependency}`,
      `  Registry   : ${data.registryName}`,
      `  Allow-list : [${data.allowList.join(', ')}]`,
    ],
    diagnostic,
  );
}

function formatDependencyNotInRegistry(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsDependencyNotInRegistryDiagnostic).data;
  return withHint(
    [header(diagnostic), `  Source     : ${data.packageName}@${data.version}`, `  Dependency : ${data.dependency}`],
    diagnostic,
  );
}

function formatDependencyRangeUnreachable(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsDependencyRangeUnreachableDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Dependency : ${data.dependency}`,
      `  Range      : ${data.range}`,
      `  Available  : ${data.availableVersions.length > 0 ? data.availableVersions.join(', ') : '(none)'}`,
    ],
    diagnostic,
  );
}

function formatRemovalDenied(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsRemovalDeniedDiagnostic).data;
  const lines = [header(diagnostic), `  Package: ${data.packageName}`];
  if (data.version) lines.push(`  Version: ${data.version}`);
  lines.push(`  Policy : ${data.policy}`);
  return withHint(lines, diagnostic);
}

function formatIntegrityMismatch(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsIntegrityMismatchDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  File    : ${data.filePath}`,
      `  Expected: ${data.expectedHash} (${data.expectedSize} bytes)`,
      `  Actual  : ${data.actualHash} (${data.actualSize} bytes)`,
    ],
    diagnostic,
  );
}

function formatReleaseFileNameInvalid(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsReleaseFileNameInvalidDiagnostic).data;
  return withHint(
    [
      header(diagnostic),
      `  Source  : ${data.packageName}@${data.version}`,
      `  Name    : ${data.fileName}`,
      `  Accepted: ${data.accepted.join(', ')}`,
    ],
    diagnostic,
  );
}

function formatOfficialPolicyViolation(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsOfficialPolicyViolationDiagnostic).data;
  const lines = [header(diagnostic), `  Rule  : ${data.rule}`, `  Detail: ${data.detail}`];
  if (data.path) lines.push(`  Path  : ${data.path}`);
  return withHint(lines, diagnostic);
}

function formatUnknownKey(diagnostic: Diagnostic): string {
  const data = (diagnostic as RegistryToolsUnknownKeyDiagnostic).data;
  return withHint([header(diagnostic), `  At   : ${data.path}`, `  Key  : ${data.key}`], diagnostic);
}

export const registryToolsFormatters: FormatterMap = {
  REGISTRY_TOOLS_PATH_MISMATCH: formatPathMismatch,
  REGISTRY_TOOLS_PACKAGE_SOURCE_MISMATCH: formatPackageSourceMismatch,
  REGISTRY_TOOLS_VERSION_EXISTS: formatVersionExists,
  REGISTRY_TOOLS_VERSION_NOT_FOUND: formatVersionNotFound,
  REGISTRY_TOOLS_PACKAGE_MISSING: formatPackageMissing,
  REGISTRY_TOOLS_VERSIONS_UNSORTED: formatVersionsUnsorted,
  REGISTRY_TOOLS_EXTERNAL_REGISTRY_DENIED: formatExternalRegistryDenied,
  REGISTRY_TOOLS_EXTERNAL_REGISTRY_NOT_ALLOWED: formatExternalRegistryNotAllowed,
  REGISTRY_TOOLS_DEPENDENCY_NOT_IN_REGISTRY: formatDependencyNotInRegistry,
  REGISTRY_TOOLS_DEPENDENCY_RANGE_UNREACHABLE: formatDependencyRangeUnreachable,
  REGISTRY_TOOLS_REMOVAL_DENIED: formatRemovalDenied,
  REGISTRY_TOOLS_INTEGRITY_MISMATCH: formatIntegrityMismatch,
  REGISTRY_TOOLS_RELEASE_FILE_NAME_INVALID: formatReleaseFileNameInvalid,
  REGISTRY_TOOLS_OFFICIAL_POLICY_VIOLATION: formatOfficialPolicyViolation,
  REGISTRY_TOOLS_UNKNOWN_KEY: formatUnknownKey,
};
