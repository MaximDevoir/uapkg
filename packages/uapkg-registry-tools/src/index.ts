// ---------------------------------------------------------------------------
// @uapkg/registry-tools — public API
//
// Programmatic, registry-owner / CI-side toolkit for uapkg registry repos.
// This package is NOT a CLI and is NOT used by normal `uapkg` consumers.
// ---------------------------------------------------------------------------

// Aggregator
export {
  getRegistryToolsAggregator,
  RegistryToolsAggregator,
} from '#registry-tools/aggregator/RegistryToolsAggregator.ts';

// Contracts
export type {
  AddPackageVersionRequest,
  ChangedManifestValidation,
  DependencyValidationReport,
  ExternalRegistryPolicyMode,
  ExternalRegistryPolicyReport,
  IntegrityAlgorithm,
  IntegrityVerificationResult,
  OfficialPackagePolicyReport,
  PackageSummary,
  PackageValidationReport,
  RegistryLintReport,
  RegistryMutationOperation,
  RegistryMutationPlan,
  RegistryMutationSummary,
  RegistryToolsOptions,
  RegistryToolsPolicy,
  RegistryValidationReport,
  RegistryVersionValidationReport,
  ReleaseFileNameReport,
  RemovalsPolicyMode,
  RemovePackageRequest,
  RemovePackageVersionRequest,
  ResolvedRegistryToolsPolicy,
  UnknownKeysPolicyMode,
  WriteManifestResult,
  WriteResult,
} from '#registry-tools/contracts/RegistryToolsTypes.ts';

// IO helpers
export { IntegrityCalculator } from '#registry-tools/io/IntegrityCalculator.ts';
export { ManifestStore } from '#registry-tools/io/ManifestStore.ts';

// Listing
export { PackageLister } from '#registry-tools/listing/PackageLister.ts';

// Mutation planners
export { AddPackageVersionPlanner } from '#registry-tools/mutation/AddPackageVersionPlanner.ts';
export { RemovePackagePlanner } from '#registry-tools/mutation/RemovePackagePlanner.ts';
export { RemovePackageVersionPlanner } from '#registry-tools/mutation/RemovePackageVersionPlanner.ts';
export { sortVersionsNewestFirst } from '#registry-tools/mutation/VersionSorter.ts';

// Paths
export { RegistryRepoPaths } from '#registry-tools/paths/RegistryRepoPaths.ts';
// Orchestrator
export { RegistryTools } from '#registry-tools/tools/RegistryTools.ts';
// Validators
export { DependencyReachabilityValidator } from '#registry-tools/validation/DependencyReachabilityValidator.ts';
export { ExternalRegistryPolicyValidator } from '#registry-tools/validation/ExternalRegistryPolicyValidator.ts';
export { ManifestValidator } from '#registry-tools/validation/ManifestValidator.ts';
export {
  type OfficialRegistryPolicyRequest,
  OfficialRegistryPolicyValidator,
} from '#registry-tools/validation/OfficialRegistryPolicyValidator.ts';
export { RegistryValidator } from '#registry-tools/validation/RegistryValidator.ts';
export { ReleaseFileNameValidator } from '#registry-tools/validation/ReleaseFileNameValidator.ts';
