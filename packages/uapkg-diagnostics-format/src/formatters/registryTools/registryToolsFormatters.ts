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

function header(d: Diagnostic): string {
  return `[${d.level.toUpperCase()} ${d.code}]: ${d.message}`;
}

function withHint(lines: string[], d: Diagnostic): string {
  if (d.hint) lines.push(`  → ${d.hint}`);
  return lines.join('\n');
}

function formatPathMismatch(d: Diagnostic): string {
  const data = (d as RegistryToolsPathMismatchDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Package : ${data.packageName}`,
      `  Expected: ${data.expectedPath}`,
      `  Actual  : ${data.actualPath}`,
    ],
    d,
  );
}

function formatPackageSourceMismatch(d: Diagnostic): string {
  const data = (d as RegistryToolsPackageSourceMismatchDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Package  : ${data.packageName}`,
      `  Existing : ${data.existing.type}:${data.existing.url}`,
      `  Requested: ${data.requested.type}:${data.requested.url}`,
    ],
    d,
  );
}

function formatVersionExists(d: Diagnostic): string {
  const data = (d as RegistryToolsVersionExistsDiagnostic).data;
  return withHint([header(d), `  Package: ${data.packageName}`, `  Version: ${data.version}`], d);
}

function formatVersionNotFound(d: Diagnostic): string {
  const data = (d as RegistryToolsVersionNotFoundDiagnostic).data;
  return withHint([header(d), `  Package: ${data.packageName}`, `  Version: ${data.version}`], d);
}

function formatPackageMissing(d: Diagnostic): string {
  const data = (d as RegistryToolsPackageMissingDiagnostic).data;
  return withHint([header(d), `  Package : ${data.packageName}`, `  Manifest: ${data.manifestPath}`], d);
}

function formatVersionsUnsorted(d: Diagnostic): string {
  const data = (d as RegistryToolsVersionsUnsortedDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Package : ${data.packageName}`,
      `  Actual  : ${data.actual.join(', ')}`,
      `  Expected: ${data.expected.join(', ')}`,
    ],
    d,
  );
}

function formatExternalRegistryDenied(d: Diagnostic): string {
  const data = (d as RegistryToolsExternalRegistryDeniedDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Bucket     : ${data.bucket}`,
      `  Dependency : ${data.dependency}`,
      `  Registry   : ${data.registryName}`,
    ],
    d,
  );
}

function formatExternalRegistryNotAllowed(d: Diagnostic): string {
  const data = (d as RegistryToolsExternalRegistryNotAllowedDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Bucket     : ${data.bucket}`,
      `  Dependency : ${data.dependency}`,
      `  Registry   : ${data.registryName}`,
      `  Allow-list : [${data.allowList.join(', ')}]`,
    ],
    d,
  );
}

function formatDependencyNotInRegistry(d: Diagnostic): string {
  const data = (d as RegistryToolsDependencyNotInRegistryDiagnostic).data;
  return withHint(
    [header(d), `  Source     : ${data.packageName}@${data.version}`, `  Dependency : ${data.dependency}`],
    d,
  );
}

function formatDependencyRangeUnreachable(d: Diagnostic): string {
  const data = (d as RegistryToolsDependencyRangeUnreachableDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Source     : ${data.packageName}@${data.version}`,
      `  Dependency : ${data.dependency}`,
      `  Range      : ${data.range}`,
      `  Available  : ${data.availableVersions.length > 0 ? data.availableVersions.join(', ') : '(none)'}`,
    ],
    d,
  );
}

function formatRemovalDenied(d: Diagnostic): string {
  const data = (d as RegistryToolsRemovalDeniedDiagnostic).data;
  const lines = [header(d), `  Package: ${data.packageName}`];
  if (data.version) lines.push(`  Version: ${data.version}`);
  lines.push(`  Policy : ${data.policy}`);
  return withHint(lines, d);
}

function formatIntegrityMismatch(d: Diagnostic): string {
  const data = (d as RegistryToolsIntegrityMismatchDiagnostic).data;
  return withHint(
    [
      header(d),
      `  File    : ${data.filePath}`,
      `  Expected: ${data.expectedHash} (${data.expectedSize} bytes)`,
      `  Actual  : ${data.actualHash} (${data.actualSize} bytes)`,
    ],
    d,
  );
}

function formatReleaseFileNameInvalid(d: Diagnostic): string {
  const data = (d as RegistryToolsReleaseFileNameInvalidDiagnostic).data;
  return withHint(
    [
      header(d),
      `  Source  : ${data.packageName}@${data.version}`,
      `  Name    : ${data.fileName}`,
      `  Accepted: ${data.accepted.join(', ')}`,
    ],
    d,
  );
}

function formatOfficialPolicyViolation(d: Diagnostic): string {
  const data = (d as RegistryToolsOfficialPolicyViolationDiagnostic).data;
  const lines = [header(d), `  Rule  : ${data.rule}`, `  Detail: ${data.detail}`];
  if (data.path) lines.push(`  Path  : ${data.path}`);
  return withHint(lines, d);
}

function formatUnknownKey(d: Diagnostic): string {
  const data = (d as RegistryToolsUnknownKeyDiagnostic).data;
  return withHint([header(d), `  At   : ${data.path}`, `  Key  : ${data.key}`], d);
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
