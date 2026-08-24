// ---------------------------------------------------------------------------
// @uapkg/registry-core — public API
// ---------------------------------------------------------------------------

export type {
  RegistryAccessOptions,
  RegistryCoreOptions,
  RegistryDescriptor,
  RegistryInstantiationResult,
  RegistryLockData,
  RegistryMetadata,
  RegistryUpdateOptions,
  RegistryUpdateResult,
  SyncDecision,
  SyncPolicyInput,
} from './contracts/RegistryCoreTypes.ts';
export { RegistryCore } from './core/RegistryCore.ts';
export {
  getRegistryCachePath,
  getRegistryLockPath,
  getRegistryMetadataPath,
  getRegistryPackagesPath,
  getRegistryRepoPath,
  getRegistryRoot,
} from './paths/RegistryPaths.ts';
export {
  type GitCommandRunner,
  type GitInteractionMode,
  type GitProcessSpawner,
  GitRunner,
  type GitRunOptions,
} from './registry/GitRunner.ts';
export { Registry } from './registry/Registry.ts';
export { RegistryLock } from './registry/RegistryLock.ts';
export { RegistryMetadataReader } from './registry/RegistryMetadataReader.ts';
export { RegistryPackageReader } from './registry/RegistryPackageReader.ts';
export { evaluateSyncPolicy } from './registry/RegistrySyncPolicy.ts';
export { RegistryUpdater } from './registry/RegistryUpdater.ts';
export { redactRegistryUrlSecrets, sanitizeRegistryUrlForDisplay } from './registry/RegistryUrlSanitizer.ts';
export { type ResolvedVersion, resolveVersion } from './resolution/PackageResolver.ts';
export { SemverSelectionPolicy } from './resolution/SemverSelectionPolicy.ts';
