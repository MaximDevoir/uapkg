// ---------------------------------------------------------------------------
// @uapkg/package-manifest — public API
// ---------------------------------------------------------------------------

export type {
  DependencyChangeResult,
  ManifestOperationOptions,
  PackageNode,
  ResolvedGraph,
  ResolverOptions,
} from './contracts/ManifestTypes.ts';
export {
  type AddDependencyOptions,
  type DependencyBucket,
  DependencyMutator,
  type RemoveDependencyResult,
} from './core/DependencyMutator.ts';
export { DevDependencyPolicy } from './core/DevDependencyPolicy.ts';
export { InstallPathResolver, type ResolvedInstallPath } from './core/InstallPathResolver.ts';
export { type LockfileChange, type LockfileDiff, LockfileDiffer } from './core/LockfileDiffer.ts';
export {
  type LockfileSyncIssue,
  type LockfileSyncIssueSeverity,
  sortLockfileSyncIssues,
} from './core/LockfileSyncIssue.ts';
export { LockfileSyncValidator } from './core/LockfileSyncValidator.ts';
export { OutdatedChecker, type OutdatedEntry, type OutdatedStatus } from './core/OutdatedChecker.ts';
export { PackageManifest, type PackageManifestOptions } from './core/PackageManifest.ts';
export { WhyGraph, type WhyPath, type WhyResult } from './core/WhyGraph.ts';
export { LockfileReader } from './io/LockfileReader.ts';
export { LockfileSyncIssueWriter } from './io/LockfileSyncIssueWriter.ts';
export { LockfileWriter } from './io/LockfileWriter.ts';
export { ManifestReader } from './io/ManifestReader.ts';
export { ManifestWriter } from './io/ManifestWriter.ts';
export { LockfileSync } from './resolver/LockfileSync.ts';
export { Resolver } from './resolver/Resolver.ts';
