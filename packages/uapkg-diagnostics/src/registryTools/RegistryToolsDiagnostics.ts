import type { DiagnosticBase } from '../base/Diagnostic.js';

// ---------------------------------------------------------------------------
// Registry-tools diagnostic codes
//
// Emitted by `@uapkg/registry-tools` when authoring, validating, or linting a
// registry repo. All diagnostics in this family default to `emitPolicy: 'once'`
// so plan-then-apply flows do not double-report the same issue.
// ---------------------------------------------------------------------------

/** Package name does not match its on-disk manifest path. */
export type RegistryToolsPathMismatchDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_PATH_MISMATCH',
  {
    readonly packageName: string;
    readonly expectedPath: string;
    readonly actualPath: string;
  }
>;

/** Existing package manifest declares a different `packageSource` than the request. */
export type RegistryToolsPackageSourceMismatchDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_PACKAGE_SOURCE_MISMATCH',
  {
    readonly packageName: string;
    readonly existing: { readonly type: string; readonly url: string };
    readonly requested: { readonly type: string; readonly url: string };
  }
>;

/** A version already exists and `overwriteExistingVersion` was not set. */
export type RegistryToolsVersionExistsDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_VERSION_EXISTS',
  {
    readonly packageName: string;
    readonly version: string;
  }
>;

/** Requested version was not found on the package. */
export type RegistryToolsVersionNotFoundDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_VERSION_NOT_FOUND',
  {
    readonly packageName: string;
    readonly version: string;
  }
>;

/** Package manifest is missing and was not allowed to be created. */
export type RegistryToolsPackageMissingDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_PACKAGE_MISSING',
  {
    readonly packageName: string;
    readonly manifestPath: string;
  }
>;

/** Versions in a manifest are not sorted newest-first by SemVer. */
export type RegistryToolsVersionsUnsortedDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_VERSIONS_UNSORTED',
  {
    readonly packageName: string;
    readonly actual: readonly string[];
    readonly expected: readonly string[];
  }
>;

/** External-registry dependency is forbidden by policy. */
export type RegistryToolsExternalRegistryDeniedDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_EXTERNAL_REGISTRY_DENIED',
  {
    readonly packageName: string;
    readonly version: string;
    readonly dependency: string;
    readonly registryName: string;
    readonly bucket: 'dependencies' | 'devDependencies' | 'peerDependencies';
  }
>;

/** External-registry dependency uses a registry name not in the allow-list. */
export type RegistryToolsExternalRegistryNotAllowedDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_EXTERNAL_REGISTRY_NOT_ALLOWED',
  {
    readonly packageName: string;
    readonly version: string;
    readonly dependency: string;
    readonly registryName: string;
    readonly allowList: readonly string[];
    readonly bucket: 'dependencies' | 'devDependencies' | 'peerDependencies';
  }
>;

/** A required (non-external) dependency is not present in this registry. */
export type RegistryToolsDependencyNotInRegistryDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_DEPENDENCY_NOT_IN_REGISTRY',
  {
    readonly packageName: string;
    readonly version: string;
    readonly dependency: string;
  }
>;

/** A dependency version range cannot be satisfied by any version in the registry. */
export type RegistryToolsDependencyRangeUnreachableDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_DEPENDENCY_RANGE_UNREACHABLE',
  {
    readonly packageName: string;
    readonly version: string;
    readonly dependency: string;
    readonly range: string;
    readonly availableVersions: readonly string[];
  }
>;

/** A removal was attempted but disallowed by policy. */
export type RegistryToolsRemovalDeniedDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_REMOVAL_DENIED',
  {
    readonly kind: 'version' | 'package';
    readonly packageName: string;
    readonly version?: string;
    readonly policy: string;
  }
>;

/** A computed integrity does not match an expected integrity. */
export type RegistryToolsIntegrityMismatchDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_INTEGRITY_MISMATCH',
  {
    readonly filePath: string;
    readonly expectedHash: string;
    readonly actualHash: string;
    readonly expectedSize: number;
    readonly actualSize: number;
  }
>;

/** A release file name does not match an accepted pattern. */
export type RegistryToolsReleaseFileNameInvalidDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_RELEASE_FILE_NAME_INVALID',
  {
    readonly packageName: string;
    readonly version: string;
    readonly fileName: string;
    readonly accepted: readonly string[];
  }
>;

/** Generic violation surfaced by the official-registry policy validator. */
export type RegistryToolsOfficialPolicyViolationDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_OFFICIAL_POLICY_VIOLATION',
  {
    readonly rule: string;
    readonly detail: string;
    readonly path?: string;
  }
>;

/** An unrecognized top-level or nested key was found in a registry manifest. */
export type RegistryToolsUnknownKeyDiagnostic = DiagnosticBase<
  'REGISTRY_TOOLS_UNKNOWN_KEY',
  {
    readonly path: string;
    readonly key: string;
  }
>;

/** Union of all registry-tools diagnostics. */
export type RegistryToolsDiagnostic =
  | RegistryToolsPathMismatchDiagnostic
  | RegistryToolsPackageSourceMismatchDiagnostic
  | RegistryToolsVersionExistsDiagnostic
  | RegistryToolsVersionNotFoundDiagnostic
  | RegistryToolsPackageMissingDiagnostic
  | RegistryToolsVersionsUnsortedDiagnostic
  | RegistryToolsExternalRegistryDeniedDiagnostic
  | RegistryToolsExternalRegistryNotAllowedDiagnostic
  | RegistryToolsDependencyNotInRegistryDiagnostic
  | RegistryToolsDependencyRangeUnreachableDiagnostic
  | RegistryToolsRemovalDeniedDiagnostic
  | RegistryToolsIntegrityMismatchDiagnostic
  | RegistryToolsReleaseFileNameInvalidDiagnostic
  | RegistryToolsOfficialPolicyViolationDiagnostic
  | RegistryToolsUnknownKeyDiagnostic;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

import { createDiagnostic } from '../base/Diagnostic.js';

const ONCE = { emitPolicy: 'once' as const };

export function createRegistryToolsPathMismatchDiagnostic(
  packageName: string,
  expectedPath: string,
  actualPath: string,
): RegistryToolsPathMismatchDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_PATH_MISMATCH',
    'error',
    `Package "${packageName}" was found at "${actualPath}" but should live at "${expectedPath}".`,
    { packageName, expectedPath, actualPath },
    'Move the manifest to packages/{first-letter}/{name}.json or correct the package name.',
    ONCE,
  );
}

export function createRegistryToolsPackageSourceMismatchDiagnostic(
  packageName: string,
  existing: { readonly type: string; readonly url: string },
  requested: { readonly type: string; readonly url: string },
): RegistryToolsPackageSourceMismatchDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_PACKAGE_SOURCE_MISMATCH',
    'error',
    `Package "${packageName}" already declares a different packageSource (${existing.type}:${existing.url}); ` +
      `the request used (${requested.type}:${requested.url}).`,
    { packageName, existing, requested },
    'Either update the request to match the existing source, or remove and re-create the package intentionally.',
    ONCE,
  );
}

export function createRegistryToolsVersionExistsDiagnostic(
  packageName: string,
  version: string,
): RegistryToolsVersionExistsDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_VERSION_EXISTS',
    'error',
    `Version "${version}" already exists for package "${packageName}".`,
    { packageName, version },
    'Pass `overwriteExistingVersion: true` to replace it, or publish a new version.',
    ONCE,
  );
}

export function createRegistryToolsVersionNotFoundDiagnostic(
  packageName: string,
  version: string,
): RegistryToolsVersionNotFoundDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_VERSION_NOT_FOUND',
    'error',
    `Version "${version}" was not found for package "${packageName}".`,
    { packageName, version },
    'Use `listVersions` to see the available versions.',
    ONCE,
  );
}

export function createRegistryToolsPackageMissingDiagnostic(
  packageName: string,
  manifestPath: string,
): RegistryToolsPackageMissingDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_PACKAGE_MISSING',
    'error',
    `Package manifest for "${packageName}" was not found at "${manifestPath}".`,
    { packageName, manifestPath },
    'Pass `createPackageManifestIfMissing: true` on the add request to create it.',
    ONCE,
  );
}

export function createRegistryToolsVersionsUnsortedDiagnostic(
  packageName: string,
  actual: readonly string[],
  expected: readonly string[],
): RegistryToolsVersionsUnsortedDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_VERSIONS_UNSORTED',
    'warning',
    `Versions on package "${packageName}" are not sorted newest-first.`,
    { packageName, actual, expected },
    'Re-write the manifest. Registry tools sorts versions newest-first by SemVer.',
    ONCE,
  );
}

export function createRegistryToolsExternalRegistryDeniedDiagnostic(
  args: Omit<RegistryToolsExternalRegistryDeniedDiagnostic['data'], never>,
): RegistryToolsExternalRegistryDeniedDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_EXTERNAL_REGISTRY_DENIED',
    'error',
    `Dependency "${args.dependency}" of "${args.packageName}@${args.version}" targets external registry ` +
      `"${args.registryName}", but external registries are denied by policy.`,
    args,
    'Set `policy.externalRegistries` to `allow-listed` or `allow-any` if cross-registry dependencies are intended.',
    ONCE,
  );
}

export function createRegistryToolsExternalRegistryNotAllowedDiagnostic(
  args: Omit<RegistryToolsExternalRegistryNotAllowedDiagnostic['data'], never>,
): RegistryToolsExternalRegistryNotAllowedDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_EXTERNAL_REGISTRY_NOT_ALLOWED',
    'error',
    `Dependency "${args.dependency}" of "${args.packageName}@${args.version}" targets external registry ` +
      `"${args.registryName}", which is not in the allow-list [${args.allowList.join(', ')}].`,
    args,
    'Add the registry name to `policy.allowedExternalRegistryNames` or remove the dependency.',
    ONCE,
  );
}

export function createRegistryToolsDependencyNotInRegistryDiagnostic(
  packageName: string,
  version: string,
  dependency: string,
): RegistryToolsDependencyNotInRegistryDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_DEPENDENCY_NOT_IN_REGISTRY',
    'error',
    `Dependency "${dependency}" of "${packageName}@${version}" is not present in this registry.`,
    { packageName, version, dependency },
    'Publish the dependency first, or mark it as an external-registry dependency.',
    ONCE,
  );
}

export function createRegistryToolsDependencyRangeUnreachableDiagnostic(
  packageName: string,
  version: string,
  dependency: string,
  range: string,
  availableVersions: readonly string[],
): RegistryToolsDependencyRangeUnreachableDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_DEPENDENCY_RANGE_UNREACHABLE',
    'error',
    `Dependency "${dependency}@${range}" of "${packageName}@${version}" cannot be satisfied by any published version.`,
    { packageName, version, dependency, range, availableVersions },
    `Available versions: ${availableVersions.length > 0 ? availableVersions.join(', ') : '(none)'}.`,
    ONCE,
  );
}

export function createRegistryToolsRemovalDeniedDiagnostic(
  kind: 'version' | 'package',
  packageName: string,
  policy: string,
  version?: string,
): RegistryToolsRemovalDeniedDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_REMOVAL_DENIED',
    'error',
    kind === 'version'
      ? `Removing version "${version ?? '?'}" of "${packageName}" is not allowed (policy: ${policy}).`
      : `Removing package "${packageName}" is not allowed (policy: ${policy}).`,
    { kind, packageName, version, policy },
    'Update `policy.removals` if removals are intentional.',
    ONCE,
  );
}

export function createRegistryToolsIntegrityMismatchDiagnostic(
  filePath: string,
  expectedHash: string,
  actualHash: string,
  expectedSize: number,
  actualSize: number,
): RegistryToolsIntegrityMismatchDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_INTEGRITY_MISMATCH',
    'error',
    `Integrity mismatch for "${filePath}".`,
    { filePath, expectedHash, actualHash, expectedSize, actualSize },
    `Expected ${expectedHash} (${expectedSize} bytes); got ${actualHash} (${actualSize} bytes).`,
    ONCE,
  );
}

export function createRegistryToolsReleaseFileNameInvalidDiagnostic(
  packageName: string,
  version: string,
  fileName: string,
  accepted: readonly string[],
): RegistryToolsReleaseFileNameInvalidDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_RELEASE_FILE_NAME_INVALID',
    'error',
    `Release file "${fileName}" for "${packageName}@${version}" is not an accepted name.`,
    { packageName, version, fileName, accepted },
    `Use one of: ${accepted.join(', ')}.`,
    ONCE,
  );
}

export function createRegistryToolsOfficialPolicyViolationDiagnostic(
  rule: string,
  detail: string,
  path?: string,
): RegistryToolsOfficialPolicyViolationDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_OFFICIAL_POLICY_VIOLATION',
    'error',
    `Official-registry policy violation (${rule}): ${detail}.`,
    { rule, detail, path },
    'Adjust the package contents to satisfy the official-registry policy and try again.',
    ONCE,
  );
}

export function createRegistryToolsUnknownKeyDiagnostic(
  path: string,
  key: string,
  level: 'warning' | 'error' = 'warning',
): RegistryToolsUnknownKeyDiagnostic {
  return createDiagnostic(
    'REGISTRY_TOOLS_UNKNOWN_KEY',
    level,
    `Unknown key "${key}" at "${path}".`,
    { path, key },
    'Remove the key, or update `@uapkg/registry-schema` if it is a new field.',
    ONCE,
  );
}
