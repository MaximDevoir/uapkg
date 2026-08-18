import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import type { RegistryVersion } from '@uapkg/registry-schema';
import { canonicalJsonStringify, sha256OfCanonicalJson } from '../json/CanonicalJson.js';
import type { ClaimedDependency, PackageClaims } from './PackageClaims.js';

/**
 * The permanent mandatory comparison core. These keys are always materialized
 * on both comparison sides (with empty/default normalization), so dropping a
 * key can never remove them from verification.
 */
export const MANDATORY_CLAIM_KEYS = [
  'name',
  'version',
  'private',
  'dependencies',
  'devDependencies',
  'peerDependencies',
] as const;

/**
 * Optional claim keys this build understands beyond the mandatory core.
 * Comparison includes an optional key only when it is present and understood
 * on BOTH sides (the shared-key intersection); one-sided keys are ignored.
 * The v1 baseline understands none.
 */
export const UNDERSTOOD_OPTIONAL_CLAIM_KEYS: readonly string[] = [];

/** One differing shared field between the packaged and registry views. */
export interface ClaimsDifference {
  readonly key: string;
  readonly packaged: string;
  readonly registry: string;
}

export interface ClaimsComparisonResult {
  readonly equal: boolean;
  readonly packagedHash: string;
  readonly registryHash: string;
  readonly differences: readonly ClaimsDifference[];
}

type ComparisonView = Record<string, unknown>;

function buildComparisonView(claims: PackageClaims, sharedOptionalKeys: ReadonlySet<string>): ComparisonView {
  const view: ComparisonView = {
    name: claims.name,
    version: claims.version,
    private: claims.private,
    dependencies: claims.dependencies,
    devDependencies: claims.devDependencies,
    peerDependencies: claims.peerDependencies,
  };
  for (const key of sharedOptionalKeys) {
    const value = (claims as unknown as Record<string, unknown>)[key];
    if (value !== undefined) view[key] = value;
  }
  return view;
}

function sharedOptionalKeys(a: PackageClaims, b: PackageClaims): ReadonlySet<string> {
  const shared = new Set<string>();
  const aRecord = a as unknown as Record<string, unknown>;
  const bRecord = b as unknown as Record<string, unknown>;
  for (const key of UNDERSTOOD_OPTIONAL_CLAIM_KEYS) {
    if (aRecord[key] !== undefined && bRecord[key] !== undefined) shared.add(key);
  }
  return shared;
}

/**
 * Compare packaged-manifest claims with the projected registry record's
 * claims over the mandatory core plus the shared understood optional keys,
 * by hashing both canonical views with SHA-256.
 */
export function compareClaims(packaged: PackageClaims, registry: PackageClaims): ClaimsComparisonResult {
  const shared = sharedOptionalKeys(packaged, registry);
  const packagedView = buildComparisonView(packaged, shared);
  const registryView = buildComparisonView(registry, shared);

  const packagedHash = sha256OfCanonicalJson(packagedView);
  const registryHash = sha256OfCanonicalJson(registryView);
  if (packagedHash === registryHash) {
    return { equal: true, packagedHash, registryHash, differences: [] };
  }

  const differences: ClaimsDifference[] = [];
  const keys = new Set([...Object.keys(packagedView), ...Object.keys(registryView)]);
  for (const key of keys) {
    const packagedCanonical = canonicalJsonStringify(packagedView[key] ?? null);
    const registryCanonical = canonicalJsonStringify(registryView[key] ?? null);
    if (packagedCanonical !== registryCanonical) {
      differences.push({ key, packaged: packagedCanonical, registry: registryCanonical });
    }
  }

  return { equal: false, packagedHash, registryHash, differences };
}

/**
 * Build the registry-side claims view for one projected version record.
 * Absent buckets and the pre-`private` record default normalize exactly like
 * packaged claims so both sides always materialize the mandatory core.
 */
export function claimsFromRegistryVersion(
  name: PackageName,
  version: PackageVersion,
  entry: RegistryVersion,
): PackageClaims {
  return {
    name,
    version,
    private: entry.private,
    dependencies: normalizeRegistryBucket(entry.dependencies),
    devDependencies: normalizeRegistryBucket(entry.devDependencies),
    peerDependencies: normalizeRegistryBucket(entry.peerDependencies),
  };
}

function normalizeRegistryBucket(bucket: RegistryVersion['dependencies']): Readonly<Record<string, ClaimedDependency>> {
  const result: Record<string, ClaimedDependency> = {};
  if (!bucket) return result;
  for (const [name, dependency] of Object.entries(bucket)) {
    result[name] = {
      version: dependency.version,
      ...(dependency.registry !== undefined ? { registry: dependency.registry } : {}),
    };
  }
  return result;
}
