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
} from './contracts/RegistryCoreTypes.js';
export { RegistryCore } from './core/RegistryCore.js';
export {
  getRegistryCachePath,
  getRegistryLockPath,
  getRegistryMetadataPath,
  getRegistryPackagesPath,
  getRegistryRepoPath,
  getRegistryRoot,
} from './paths/RegistryPaths.js';
export {
  type GitCommandRunner,
  type GitInteractionMode,
  type GitProcessSpawner,
  GitRunner,
  type GitRunOptions,
} from './registry/GitRunner.js';
export { Registry } from './registry/Registry.js';
export { RegistryLock } from './registry/RegistryLock.js';
export { RegistryMetadataReader } from './registry/RegistryMetadataReader.js';
export { RegistryPackageReader } from './registry/RegistryPackageReader.js';
export { evaluateSyncPolicy } from './registry/RegistrySyncPolicy.js';
export { RegistryUpdater } from './registry/RegistryUpdater.js';
export {
  redactRegistryUrlSecrets,
  sanitizeRegistryUrlForDisplay,
} from './registry/RegistryUrlSanitizer.js';
export { type ResolvedVersion, resolveVersion } from './resolution/PackageResolver.js';
export { SemverSelectionPolicy } from './resolution/SemverSelectionPolicy.js';
