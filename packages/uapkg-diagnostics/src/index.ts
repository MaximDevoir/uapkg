// ---------------------------------------------------------------------------
// @uapkg/diagnostics — public API
// ---------------------------------------------------------------------------

export type { DiagnosticBase, DiagnosticEmitPolicy } from './base/Diagnostic.ts';
export { createDiagnostic } from './base/Diagnostic.ts';
export { DiagnosticBag } from './base/DiagnosticBag.ts';
export { createDiagnosticFingerprint } from './base/DiagnosticFingerprint.ts';
// Base primitives
export type { DiagnosticLevel } from './base/DiagnosticLevel.ts';
export type { Result, ResultFail, ResultOk } from './base/Result.ts';
export { fail, fromDiagnostics, ok } from './base/Result.ts';
// --- Config family ---
export type {
  ConfigDiagnostic,
  ConfigInvalidJsonDiagnostic,
  ConfigInvalidValueDiagnostic,
  ConfigTypeMismatchDiagnostic,
  ConfigUnknownKeyDiagnostic,
  ConfigUnresolvedDefaultRegistryDiagnostic,
} from './config/ConfigDiagnostics.ts';
export {
  createConfigInvalidJsonDiagnostic,
  createConfigInvalidValueDiagnostic,
  createConfigTypeMismatchDiagnostic,
  createConfigUnknownKeyDiagnostic,
  createConfigUnresolvedDefaultRegistryDiagnostic,
} from './config/ConfigDiagnostics.ts';
// --- Control-plane family ---
export type {
  ControlPlaneCommandFailedDiagnostic,
  ControlPlaneCommandFailedDiagnosticData,
  ControlPlaneDiagnostic,
  LoginAccessDeniedDiagnostic,
  LoginAuthorizationResponseInvalidDiagnostic,
  LoginAuthorizationTimeoutDiagnostic,
  LoginDiagnosticByCode,
  LoginDiagnosticCode,
  LoginDiagnosticData,
  LoginFailedDiagnostic,
  LoginOAuthErrorDiagnostic,
  LoginReauthorizationConflictDiagnostic,
} from './controlPlane/ControlPlaneDiagnostics.ts';
export { createControlPlaneCommandFailedDiagnostic } from './controlPlane/ControlPlaneDiagnostics.ts';
// --- General family ---
export type {
  GeneralDiagnostic,
  IoErrorDiagnostic,
  ParseErrorDiagnostic,
  UnknownErrorDiagnostic,
} from './general/GeneralDiagnostics.ts';
export {
  createIoErrorDiagnostic,
  createParseErrorDiagnostic,
  createUnknownErrorDiagnostic,
} from './general/GeneralDiagnostics.ts';
// --- Installer family ---
export type {
  DiskRemoveFailedDiagnostic,
  DownloadFailedDiagnostic,
  DownloadHttpStatusDiagnostic,
  ExtractionFailedDiagnostic,
  InstallerDiagnostic,
  IntegrityMismatchDiagnostic,
  NetworkRetriesExhaustedDiagnostic,
  NetworkTimeoutDiagnostic,
} from './installer/InstallerDiagnostics.ts';
export {
  createDiskRemoveFailedDiagnostic,
  createDownloadFailedDiagnostic,
  createDownloadHttpStatusDiagnostic,
  createExtractionFailedDiagnostic,
  createIntegrityMismatchDiagnostic,
  createNetworkRetriesExhaustedDiagnostic,
  createNetworkTimeoutDiagnostic,
} from './installer/InstallerDiagnostics.ts';
// --- Manifest family ---
export type {
  DependencyNotFoundDiagnostic,
  ForbiddenOverridesDiagnostic,
  LockfileInvalidDiagnostic,
  LockfileMissingDiagnostic,
  LockfileOutOfSyncDiagnostic,
  ManifestDiagnostic,
  ManifestInvalidDiagnostic,
  ManifestReadErrorDiagnostic,
  ManifestWriteErrorDiagnostic,
  UnresolvedRegistryDiagnostic,
} from './manifest/ManifestDiagnostics.ts';
export {
  createDependencyNotFoundDiagnostic,
  createForbiddenOverridesDiagnostic,
  createLockfileInvalidDiagnostic,
  createLockfileMissingDiagnostic,
  createLockfileOutOfSyncDiagnostic,
  createManifestInvalidDiagnostic,
  createManifestReadErrorDiagnostic,
  createManifestWriteErrorDiagnostic,
  createUnresolvedRegistryDiagnostic,
} from './manifest/ManifestDiagnostics.ts';
// --- Pack family ---
export type {
  CyclicSymlinkDiagnostic,
  InvalidPathDiagnostic,
  LfsSkippedDiagnostic,
  NoFilesSelectedDiagnostic,
  OutFileIsDirectoryDiagnostic,
  PackDiagnostic,
  PluginRootNotFoundDiagnostic,
  SymlinkOutsideRootDiagnostic,
  UnresolvedLfsDiagnostic,
  UpluginMissingDiagnostic,
} from './pack/PackDiagnostics.ts';
export {
  createCyclicSymlinkDiagnostic,
  createInvalidPathDiagnostic,
  createLfsSkippedDiagnostic,
  createNoFilesSelectedDiagnostic,
  createOutFileIsDirectoryDiagnostic,
  createPluginRootNotFoundDiagnostic,
  createSymlinkOutsideRootDiagnostic,
  createUnresolvedLfsDiagnostic,
  createUpluginMissingDiagnostic,
} from './pack/PackDiagnostics.ts';
// --- Postinstall family ---
export type {
  PostinstallDiagnostic,
  PostinstallDuplicateEntryDiagnostic,
  PostinstallEsbuildErrorDiagnostic,
  PostinstallInvalidExportDiagnostic,
  PostinstallLoadFailedDiagnostic,
  PostinstallMarkerCorruptDiagnostic,
  PostinstallPolicyDeniedDiagnostic,
} from './postinstall/PostinstallDiagnostics.ts';
export {
  createPostinstallDuplicateEntryDiagnostic,
  createPostinstallEsbuildErrorDiagnostic,
  createPostinstallInvalidExportDiagnostic,
  createPostinstallLoadFailedDiagnostic,
  createPostinstallMarkerCorruptDiagnostic,
  createPostinstallPolicyDeniedDiagnostic,
} from './postinstall/PostinstallDiagnostics.ts';
// --- Publishing family ---
export type {
  PublishDiagnosticFact,
  PublishDiagnosticResource,
  PublishingDiagnostic,
  PublishRequestFailedDiagnostic,
  PublishRequestFailedDiagnosticData,
} from './publishing/PublishingDiagnostics.ts';
export { createPublishRequestFailedDiagnostic } from './publishing/PublishingDiagnostics.ts';
// --- Registry family ---
export type {
  CacheCorruptDiagnostic,
  CacheIdentifierCollisionDiagnostic,
  CacheReadErrorDiagnostic,
  GitErrorDiagnostic,
  LockAcquisitionFailedDiagnostic,
  NetworkErrorDiagnostic,
  RegistryDiagnostic,
  RegistryNotFoundDiagnostic,
  RegistryUnreachableDiagnostic,
  SchemaInvalidDiagnostic,
} from './registry/RegistryDiagnostics.ts';
export {
  createCacheCorruptDiagnostic,
  createCacheIdentifierCollisionDiagnostic,
  createCacheReadErrorDiagnostic,
  createGitErrorDiagnostic,
  createLockAcquisitionFailedDiagnostic,
  createNetworkErrorDiagnostic,
  createRegistryNotFoundDiagnostic,
  createRegistryUnreachableDiagnostic,
  createSchemaInvalidDiagnostic,
} from './registry/RegistryDiagnostics.ts';
// --- Registry-tools family ---
export type {
  RegistryToolsDependencyNotInRegistryDiagnostic,
  RegistryToolsDependencyRangeUnreachableDiagnostic,
  RegistryToolsDiagnostic,
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
} from './registryTools/RegistryToolsDiagnostics.ts';
export {
  createRegistryToolsDependencyNotInRegistryDiagnostic,
  createRegistryToolsDependencyRangeUnreachableDiagnostic,
  createRegistryToolsExternalRegistryDeniedDiagnostic,
  createRegistryToolsExternalRegistryNotAllowedDiagnostic,
  createRegistryToolsIntegrityMismatchDiagnostic,
  createRegistryToolsOfficialPolicyViolationDiagnostic,
  createRegistryToolsPackageMissingDiagnostic,
  createRegistryToolsPackageSourceMismatchDiagnostic,
  createRegistryToolsPathMismatchDiagnostic,
  createRegistryToolsReleaseFileNameInvalidDiagnostic,
  createRegistryToolsRemovalDeniedDiagnostic,
  createRegistryToolsUnknownKeyDiagnostic,
  createRegistryToolsVersionExistsDiagnostic,
  createRegistryToolsVersionNotFoundDiagnostic,
  createRegistryToolsVersionsUnsortedDiagnostic,
} from './registryTools/RegistryToolsDiagnostics.ts';
// --- Resolver family ---
export type {
  CircularDepDiagnostic,
  PackageNotFoundDiagnostic,
  RegistryNameCollisionDiagnostic,
  ResolverDiagnostic,
  VersionConflictDiagnostic,
  VersionNotFoundDiagnostic,
} from './resolver/ResolverDiagnostics.ts';
export {
  createCircularDepDiagnostic,
  createPackageNotFoundDiagnostic,
  createRegistryNameCollisionDiagnostic,
  createVersionConflictDiagnostic,
  createVersionNotFoundDiagnostic,
} from './resolver/ResolverDiagnostics.ts';
// --- Safety family ---
export type {
  SafetyDiagnostic,
  SafetyOverriddenByForceDiagnostic,
  SafetyPathNotProjectManifestDiagnostic,
  SafetyTargetExistsNoManifestDiagnostic,
} from './safety/SafetyDiagnostics.ts';
export {
  createSafetyOverriddenByForceDiagnostic,
  createSafetyPathNotProjectManifestDiagnostic,
  createSafetyTargetExistsNoManifestDiagnostic,
} from './safety/SafetyDiagnostics.ts';
// --- Spec-parse family ---
export type {
  InvalidOrgNameDiagnostic,
  InvalidPackageSpecDiagnostic,
  InvalidVersionRangeDiagnostic,
  SpecParseDiagnostic,
} from './spec/SpecDiagnostics.ts';
export {
  createInvalidOrgNameDiagnostic,
  createInvalidPackageSpecDiagnostic,
  createInvalidVersionRangeDiagnostic,
} from './spec/SpecDiagnostics.ts';
// Unified type
export type { Diagnostic, DiagnosticByCode, DiagnosticCode } from './types.ts';
