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
} from './aggregator/RegistryToolsAggregator.js';

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
} from './contracts/RegistryToolsTypes.js';

// IO helpers
export { IntegrityCalculator } from './io/IntegrityCalculator.js';
export { ManifestStore } from './io/ManifestStore.js';

// Listing
export { PackageLister } from './listing/PackageLister.js';

// Mutation planners
export { AddPackageVersionPlanner } from './mutation/AddPackageVersionPlanner.js';
export { RemovePackagePlanner } from './mutation/RemovePackagePlanner.js';
export { RemovePackageVersionPlanner } from './mutation/RemovePackageVersionPlanner.js';
export { sortVersionsNewestFirst } from './mutation/VersionSorter.js';

// Paths
export { RegistryRepoPaths } from './paths/RegistryRepoPaths.js';
// Orchestrator
export { RegistryTools } from './tools/RegistryTools.js';
// Validators
export { DependencyReachabilityValidator } from './validation/DependencyReachabilityValidator.js';
export { ExternalRegistryPolicyValidator } from './validation/ExternalRegistryPolicyValidator.js';
export { ManifestValidator } from './validation/ManifestValidator.js';
export {
  type OfficialRegistryPolicyRequest,
  OfficialRegistryPolicyValidator,
} from './validation/OfficialRegistryPolicyValidator.js';
export { RegistryValidator } from './validation/RegistryValidator.js';
export { ReleaseFileNameValidator } from './validation/ReleaseFileNameValidator.js';
