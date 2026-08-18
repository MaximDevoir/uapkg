// ---------------------------------------------------------------------------
// @uapkg/registry-schema — public API
// ---------------------------------------------------------------------------

// Paths
export { getRegistryPackagePath, getRegistryPackagePathSegments } from './paths/RegistryPackagePath.js';
// Schemas
export { type Integrity, IntegritySchema } from './schemas/IntegritySchema.js';
export {
  createPackageRegistryManifestSchema,
  type PackageRegistryManifest,
  PackageRegistryManifestSchema,
} from './schemas/PackageRegistryManifestSchema.js';
export { type PackageSource, PackageSourceSchema } from './schemas/PackageSourceSchema.js';
export { type RegistryAsset, RegistryAssetSchema } from './schemas/RegistryAssetSchema.js';
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
} from './schemas/RegistryDependencySchema.js';
export {
  type RegistryMeta,
  RegistryMetaSchema,
  type RegistryType,
  RegistryTypeSchema,
} from './schemas/RegistryMetaSchema.js';
export {
  type RegistryVersion,
  RegistryVersionSchema,
  type ReleaseFiles,
  ReleaseFilesSchema,
  type VersionMeta,
  VersionMetaSchema,
} from './schemas/RegistryVersionSchema.js';
