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
} from './archive/PackagedManifestReader.ts';
export {
  type ClaimsComparisonResult,
  type ClaimsDifference,
  claimsFromRegistryVersion,
  compareClaims,
  MANDATORY_CLAIM_KEYS,
  UNDERSTOOD_OPTIONAL_CLAIM_KEYS,
} from './claims/ClaimsComparison.ts';
export { normalizePackageClaims } from './claims/PackageClaims.ts';
export { canonicalJsonStringify, parseJsonStrict, sha256OfCanonicalJson } from './json/CanonicalJson.ts';
export type { ClaimedDependency, PackageClaims } from './schema/index.ts';
