// ---------------------------------------------------------------------------
// @uapkg/package-manifest-schema — public API
// ---------------------------------------------------------------------------

// Lockfile schemas
export { type LockDependency, LockDependencySchema } from './lockfile/LockDependencySchema.ts';
export { type Lockfile, LockfileSchema } from './lockfile/LockfileSchema.ts';
export { type BaseManifest, BaseManifestSchema } from './manifest/BaseManifestSchema.ts';
// Manifest schemas
export {
  type Dependency,
  type DependencyDeclaration,
  DependencyDeclarationSchema,
  DependencyLongSchema,
  DependencySchema,
  DependencyShortSchema,
  normalizeDependencyDeclaration,
  normalizeDependencyRecord,
  toDependencyDeclaration,
  toDependencyRecordDeclaration,
} from './manifest/DependencySchema.ts';
export { type ManifestKind, ManifestKindSchema } from './manifest/ManifestKind.ts';
export { type Manifest, ManifestSchema } from './manifest/ManifestSchema.ts';
export { type PluginManifest, PluginManifestSchema } from './manifest/PluginManifestSchema.ts';
export {
  type ProjectManifest,
  ProjectManifestSchema,
  type ProjectPostinstall,
  ProjectPostinstallSchema,
} from './manifest/ProjectManifestSchema.ts';
export { type Publish, PublishSchema } from './manifest/PublishSchema.ts';
