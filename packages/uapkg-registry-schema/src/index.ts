// ---------------------------------------------------------------------------
// @uapkg/registry-schema — public API
// ---------------------------------------------------------------------------

// Paths
export { getRegistryPackagePath, getRegistryPackagePathSegments } from '#registry-schema/paths/RegistryPackagePath.ts';
// Schemas
export { type Integrity, IntegritySchema } from '#registry-schema/schemas/IntegritySchema.ts';
export {
  createPackageRegistryManifestSchema,
  type PackageRegistryManifest,
  PackageRegistryManifestSchema,
} from '#registry-schema/schemas/PackageRegistryManifestSchema.ts';
export { type PackageSource, PackageSourceSchema } from '#registry-schema/schemas/PackageSourceSchema.ts';
export { type RegistryAsset, RegistryAssetSchema } from '#registry-schema/schemas/RegistryAssetSchema.ts';
export {
  normalizeRegistryDependencyDeclaration,
  normalizeRegistryDependencyRecord,
  type RegistryDependency,
  type RegistryDependencyDeclaration,
  RegistryDependencyDeclarationSchema,
  RegistryDependencyLongSchema,
  RegistryDependencySchema,
  RegistryDependencyShortSchema,
  toRegistryDependencyDeclaration,
  toRegistryDependencyRecordDeclaration,
} from '#registry-schema/schemas/RegistryDependencySchema.ts';
export {
  type RegistryMeta,
  RegistryMetaSchema,
  type RegistryType,
  RegistryTypeSchema,
} from '#registry-schema/schemas/RegistryMetaSchema.ts';
export {
  type RegistryVersion,
  RegistryVersionSchema,
  type ReleaseFiles,
  ReleaseFilesSchema,
  type VersionMeta,
  VersionMetaSchema,
} from '#registry-schema/schemas/RegistryVersionSchema.ts';
