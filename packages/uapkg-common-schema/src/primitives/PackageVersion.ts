import { parse as parseSemver } from 'semver';
import { z } from 'zod';
import type { Brand } from '../brand/Brand.js';

/**
 * Branded type for a valid semver v2 version string (no `v` or `=` prefix).
 */
export type PackageVersion = Brand<string, 'PackageVersion'>;

export const PackageVersionSchema = z
  .string()
  .min(1, 'Package version must not be empty')
  .refine(isCanonicalSemver, { message: 'Invalid canonical semver version' })
  .brand('PackageVersion');

function isCanonicalSemver(value: string): boolean {
  const parsed = parseSemver(value);
  if (!parsed) return false;
  const build = parsed.build.length > 0 ? `+${parsed.build.join('.')}` : '';
  return value === `${parsed.version}${build}`;
}
