import { z } from 'zod';
import type { Brand } from '../brand/Brand.js';

/**
 * Branded type for a uapkg package name.
 * Unscoped (`my-package`) or scoped (`@owner/my-package`); each segment is
 * lowercase alphanumeric with hyphens.
 */
export type PackageName = Brand<string, 'PackageName'>;

export const PackageNameSchema = z
  .string()
  .max(214, 'Package name must be at most 214 characters')
  .regex(
    /^(?:@[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9-]*$/,
    'Package name must be lowercase alphanumeric with hyphens, optionally scoped as @owner/package',
  )
  .transform((v) => v as PackageName);

/** True when the package name uses the `@owner/package` scoped form. */
export function isScopedPackageName(name: string): boolean {
  return name.startsWith('@');
}
