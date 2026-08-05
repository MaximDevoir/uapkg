// ---------------------------------------------------------------------------
// @uapkg/package-claims — public API
//
// Shared packaged-manifest reader and canonical claims comparison used by the
// publish CLI (preflight) and the installer (enforcement).
// ---------------------------------------------------------------------------

export {
  type PackagedManifest,
  type ReadPackagedManifestOptions,
  readPackageClaimsFromArchive,
  readPackagedManifest,
} from './archive/PackagedManifestReader.js';
export {
  type ClaimsComparisonResult,
  type ClaimsDifference,
  claimsFromRegistryVersion,
  compareClaims,
  MANDATORY_CLAIM_KEYS,
  UNDERSTOOD_OPTIONAL_CLAIM_KEYS,
} from './claims/ClaimsComparison.js';
export { type ClaimedDependency, normalizePackageClaims, type PackageClaims } from './claims/PackageClaims.js';
export { canonicalJsonStringify, parseJsonStrict, sha256OfCanonicalJson } from './json/CanonicalJson.js';
