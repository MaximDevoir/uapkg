// ---------------------------------------------------------------------------
// @uapkg/registry-tools — public API
//
// Programmatic, registry-owner / CI-side toolkit for uapkg registry repos.
// This package is NOT a CLI and is NOT used by normal `uapkg` consumers.
// ---------------------------------------------------------------------------

// Aggregator
export { getRegistryToolsAggregator, RegistryToolsAggregator } from './aggregator/RegistryToolsAggregator.ts';

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
} from './contracts/RegistryToolsTypes.ts';

// IO helpers
export { IntegrityCalculator } from './io/IntegrityCalculator.ts';
export { ManifestStore } from './io/ManifestStore.ts';

// Listing
export { PackageLister } from './listing/PackageLister.ts';

// Mutation planners
export { AddPackageVersionPlanner } from './mutation/AddPackageVersionPlanner.ts';
export { RemovePackagePlanner } from './mutation/RemovePackagePlanner.ts';
export { RemovePackageVersionPlanner } from './mutation/RemovePackageVersionPlanner.ts';
export { sortVersionsNewestFirst } from './mutation/VersionSorter.ts';

// Paths
export { RegistryRepoPaths } from './paths/RegistryRepoPaths.ts';
// Orchestrator
export { RegistryTools } from './tools/RegistryTools.ts';
// Validators
export { DependencyReachabilityValidator } from './validation/DependencyReachabilityValidator.ts';
export { ExternalRegistryPolicyValidator } from './validation/ExternalRegistryPolicyValidator.ts';
export { ManifestValidator } from './validation/ManifestValidator.ts';
export {
  type OfficialRegistryPolicyRequest,
  OfficialRegistryPolicyValidator,
} from './validation/OfficialRegistryPolicyValidator.ts';
export { RegistryValidator } from './validation/RegistryValidator.ts';
export { ReleaseFileNameValidator } from './validation/ReleaseFileNameValidator.ts';
