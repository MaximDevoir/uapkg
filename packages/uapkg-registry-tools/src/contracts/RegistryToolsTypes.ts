import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import type { Diagnostic } from '@uapkg/diagnostics';
import type { Integrity, PackageRegistryManifest, PackageSource, RegistryVersion } from '@uapkg/registry-schema';

// ---------------------------------------------------------------------------
// Options & policy
// ---------------------------------------------------------------------------

export type ExternalRegistryPolicyMode = 'deny' | 'allow-listed' | 'allow-any';
export type RemovalsPolicyMode = 'deny' | 'allow-version-remove' | 'allow-package-remove';
export type UnknownKeysPolicyMode = 'ignore' | 'warn' | 'error';

export interface RegistryToolsPolicy {
  readonly externalRegistries?: ExternalRegistryPolicyMode;
  readonly allowedExternalRegistryNames?: readonly string[];
  readonly removals?: RemovalsPolicyMode;
  readonly unknownKeys?: UnknownKeysPolicyMode;
  readonly requireExistingDependencies?: boolean;
  readonly requireReachableDependencyRanges?: boolean;
  readonly requireSortedVersions?: boolean;
}

/** Fully resolved policy with defaults applied. */
export type ResolvedRegistryToolsPolicy = Required<RegistryToolsPolicy>;

export interface RegistryToolsOptions {
  /** Root directory of the registry repo (NOT a package directory). */
  readonly cwd: string;
  readonly policy?: RegistryToolsPolicy;
}

// ---------------------------------------------------------------------------
// Read / list results
// ---------------------------------------------------------------------------

export interface PackageSummary {
  readonly name: PackageName;
  readonly manifestPath: string;
  readonly versionCount: number;
}

export interface WriteManifestResult {
  readonly manifestPath: string;
  readonly bytesWritten: number;
}

export interface WriteResult {
  readonly path: string;
  readonly bytesWritten: number;
}

// ---------------------------------------------------------------------------
// Validation reports
// ---------------------------------------------------------------------------

export interface RegistryVersionValidationReport {
  readonly packageName: PackageName;
  readonly version: PackageVersion;
  readonly diagnostics: readonly Diagnostic[];
}

export interface PackageValidationReport {
  readonly packageName: PackageName;
  readonly manifestPath: string;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RegistryValidationReport {
  readonly packageReports: readonly PackageValidationReport[];
  readonly diagnostics: readonly Diagnostic[];
}

export interface RegistryLintReport {
  readonly diagnostics: readonly Diagnostic[];
}

export interface ChangedManifestValidation {
  readonly perFile: readonly {
    readonly path: string;
    readonly diagnostics: readonly Diagnostic[];
  }[];
}

export interface DependencyValidationReport {
  readonly packageName: PackageName;
  readonly version: PackageVersion;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ExternalRegistryPolicyReport {
  readonly diagnostics: readonly Diagnostic[];
}

export interface ReleaseFileNameReport {
  readonly diagnostics: readonly Diagnostic[];
}

export interface OfficialPackagePolicyReport {
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Mutation requests
// ---------------------------------------------------------------------------

export interface AddPackageVersionRequest {
  readonly packageName: PackageName;
  readonly version: PackageVersion;
  readonly packageSource: PackageSource;
  readonly registryVersion: RegistryVersion;
  readonly createPackageManifestIfMissing?: boolean;
  readonly overwriteExistingVersion?: boolean;
}

export interface RemovePackageVersionRequest {
  readonly packageName: PackageName;
  readonly version: PackageVersion;
}

export interface RemovePackageRequest {
  readonly packageName: PackageName;
}

// ---------------------------------------------------------------------------
// Mutation plans / summaries
// ---------------------------------------------------------------------------

export type RegistryMutationOperation =
  | { readonly kind: 'create-manifest'; readonly path: string }
  | { readonly kind: 'update-manifest'; readonly path: string }
  | { readonly kind: 'delete-manifest'; readonly path: string };

export interface RegistryMutationPlan {
  readonly operations: readonly RegistryMutationOperation[];
  readonly nextManifest?: PackageRegistryManifest;
  readonly diagnostics: readonly Diagnostic[];
}

export interface RegistryMutationSummary {
  readonly operations: readonly RegistryMutationOperation[];
  readonly diagnostics: readonly Diagnostic[];
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

export type IntegrityAlgorithm = 'sha256' | 'sha512';

export interface IntegrityVerificationResult {
  readonly ok: boolean;
  readonly actual: Integrity;
  readonly expected: Integrity;
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const REGISTRY_TOOLS_PACKAGES_DIR = 'packages';
