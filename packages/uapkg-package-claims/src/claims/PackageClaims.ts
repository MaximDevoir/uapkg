import {
  type PackageName,
  PackageNameSchema,
  type PackageVersion,
  PackageVersionSchema,
  type RegistryName,
} from '@uapkg/common-schema';
import { DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import { DependencyDeclarationSchema, normalizeDependencyDeclaration } from '@uapkg/package-manifest-schema';
import { z } from 'zod';

/**
 * A dependency claim: the canonical published form of a manifest dependency.
 * An absent `registry` means the dependency inherits the containing registry;
 * install-path overrides never appear in published claims.
 */
export interface ClaimedDependency {
  readonly version: string;
  readonly registry?: RegistryName;
}

/**
 * Normalized publication claims extracted from a packaged `uapkg.json`.
 *
 * This is the permanent mandatory comparison core: `name`, `version`, the
 * three dependency buckets (absent buckets normalize to empty maps), and the
 * normalized `private` policy field (absent normalizes to `false`).
 */
export interface PackageClaims {
  readonly name: PackageName;
  readonly version: PackageVersion;
  readonly private: boolean;
  readonly dependencies: Readonly<Record<string, ClaimedDependency>>;
  readonly devDependencies: Readonly<Record<string, ClaimedDependency>>;
  readonly peerDependencies: Readonly<Record<string, ClaimedDependency>>;
}

/**
 * Claims-focused manifest view: validates only the fields that publication
 * claims need and tolerates every unknown member, so a manifest written for
 * a newer client still yields claims for this one.
 */
const ClaimsManifestSchema = z.looseObject({
  name: PackageNameSchema,
  version: PackageVersionSchema,
  private: z.boolean().optional(),
  dependencies: z.record(z.string(), DependencyDeclarationSchema).optional(),
  devDependencies: z.record(z.string(), DependencyDeclarationSchema).optional(),
  peerDependencies: z.record(z.string(), DependencyDeclarationSchema).optional(),
});

function normalizeBucket(
  bucket: Record<string, z.infer<typeof DependencyDeclarationSchema>> | undefined,
): Record<string, ClaimedDependency> {
  const result: Record<string, ClaimedDependency> = {};
  if (!bucket) return result;
  for (const [name, declaration] of Object.entries(bucket)) {
    const normalized = normalizeDependencyDeclaration(declaration);
    // `path` is a local install concern and is never part of published claims.
    result[name] = {
      version: normalized.version as string,
      ...(normalized.registry !== undefined ? { registry: normalized.registry } : {}),
    };
  }
  return result;
}

/**
 * Normalize a parsed packaged-manifest value into publication claims.
 */
export function normalizePackageClaims(rawManifest: unknown): Result<PackageClaims> {
  const bag = new DiagnosticBag();
  const parsed = ClaimsManifestSchema.safeParse(rawManifest);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    bag.addError(
      'CLAIMS_MANIFEST_INVALID',
      `Packaged manifest cannot supply publication claims: ${issues.join('; ')}`,
      {
        issues,
      },
    );
    return bag.toFailure();
  }

  const manifest = parsed.data;
  return ok({
    name: manifest.name,
    version: manifest.version,
    private: manifest.private ?? false,
    dependencies: normalizeBucket(manifest.dependencies),
    devDependencies: normalizeBucket(manifest.devDependencies),
    peerDependencies: normalizeBucket(manifest.peerDependencies),
  });
}
