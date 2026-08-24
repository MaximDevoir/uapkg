// ---------------------------------------------------------------------------
// @uapkg/common-schema — public API
// ---------------------------------------------------------------------------

// Brand utility
export type { Brand } from './brand/Brand.ts';
export type { AssetHash } from './primitives/AssetHash.ts';
export { AssetHashSchema } from './primitives/AssetHash.ts';
export type { ConcurrencyCount } from './primitives/ConcurrencyCount.ts';
export { ConcurrencyCountSchema } from './primitives/ConcurrencyCount.ts';
export type { DurationSeconds } from './primitives/DurationSeconds.ts';
export { DurationSecondsSchema } from './primitives/DurationSeconds.ts';
export type { GitTree } from './primitives/GitTree.ts';
export { GitTreeSchema } from './primitives/GitTree.ts';
export type { InstallPath } from './primitives/InstallPath.ts';
export { InstallPathSchema } from './primitives/InstallPath.ts';
// Added in Phase 0 (commands/installer/postinstall work)
export type { OrgName } from './primitives/OrgName.ts';
export { OrgNameSchema } from './primitives/OrgName.ts';
// Branded primitives — types
export type { PackageName } from './primitives/PackageName.ts';
// Branded primitives — Zod schemas
export { isScopedPackageName, PackageNameSchema } from './primitives/PackageName.ts';
export type { PackageSpec } from './primitives/PackageSpec.ts';
export { PackageSpecSchema } from './primitives/PackageSpec.ts';
export type { PackageVersion } from './primitives/PackageVersion.ts';
export { PackageVersionSchema } from './primitives/PackageVersion.ts';
export type { PostInstallPolicy } from './primitives/PostInstallPolicy.ts';
export { POSTINSTALL_POLICY_DEFAULT, PostInstallPolicySchema } from './primitives/PostInstallPolicy.ts';
export type { RegistryIdentifier, RegistryIdentifierShort } from './primitives/RegistryIdentifier.ts';
export { RegistryIdentifierSchema, RegistryIdentifierShortSchema } from './primitives/RegistryIdentifier.ts';
export type { RegistryName } from './primitives/RegistryName.ts';
export { DEFAULT_REGISTRY_ALIAS, RegistryNameSchema } from './primitives/RegistryName.ts';
export type { RegistryURL } from './primitives/RegistryURL.ts';
export { RegistryURLSchema } from './primitives/RegistryURL.ts';
export type { UnixTimestamp } from './primitives/UnixTimestamp.ts';
export { UnixTimestampSchema } from './primitives/UnixTimestamp.ts';
export type { VersionRange } from './primitives/VersionRange.ts';
export { VersionRangeSchema } from './primitives/VersionRange.ts';
