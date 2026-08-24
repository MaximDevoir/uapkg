// ---------------------------------------------------------------------------
// @uapkg/registry-schema — public API
// ---------------------------------------------------------------------------

// Paths
export { getRegistryPackagePath, getRegistryPackagePathSegments } from './paths/RegistryPackagePath.ts';
// Schemas
export { type Integrity, IntegritySchema } from './schemas/IntegritySchema.ts';
export {
  createPackageRegistryManifestSchema,
  type PackageRegistryManifest,
  PackageRegistryManifestSchema,
} from './schemas/PackageRegistryManifestSchema.ts';
export { type PackageSource, PackageSourceSchema } from './schemas/PackageSourceSchema.ts';
export { type RegistryAsset, RegistryAssetSchema } from './schemas/RegistryAssetSchema.ts';
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
} from './schemas/RegistryDependencySchema.ts';
export {
  type RegistryMeta,
  RegistryMetaSchema,
  type RegistryType,
  RegistryTypeSchema,
} from './schemas/RegistryMetaSchema.ts';
export {
  type RegistryVersion,
  RegistryVersionSchema,
  type ReleaseFiles,
  ReleaseFilesSchema,
  type VersionMeta,
  VersionMetaSchema,
} from './schemas/RegistryVersionSchema.ts';
