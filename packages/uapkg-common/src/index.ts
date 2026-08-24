// ---------------------------------------------------------------------------
// @uapkg/common — public API
// ---------------------------------------------------------------------------

// Human formatting
export { prettyBytes, prettyBytesProgress } from './format/prettyBytes.ts';
export {
  computeRegistryIdentifier,
  computeRegistryIdentifierShort,
  type RegistryIdentityDescriptor,
} from './hash/registryIdentifier.ts';
// Hashing
export { sha256, sha256Prefixed } from './hash/sha256.ts';
export { safeJsonParse } from './json/safeJsonParse.ts';
// JSON
export { stableStringify } from './json/stableStringify.ts';
// Normalization
export { normalizeUrl } from './normalize/normalizeUrl.ts';
// Paths
export { normalizePath, toForwardSlash } from './paths/forwardSlash.ts';
// Runtime profile
export {
  INTERNAL_BUILD_MODE_ENV,
  INTERNAL_PROFILE_HOME_ENV,
  resolveActiveUapkgProfileRoot,
  resolveUapkgBuildMode,
  resolveUapkgProfileRoot,
  type UAPKGBuildMode,
} from './runtime/UapkgRuntimeProfile.ts';
// Package spec parsing (CLI "@org/name@range")
export { formatPackageSpec, parsePackageSpec } from './spec/parsePackageSpec.ts';
