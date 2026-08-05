import { isScopedPackageName } from '@uapkg/common-schema';

/**
 * Canonical repository-relative path of a package's registry manifest.
 *
 * - unscoped: `packages/{first-letter}/{package-name}.json`
 * - scoped:   `packages/@{scope}/{package-name}.json`
 *
 * Segments are returned for path-separator-agnostic joining; use
 * {@link getRegistryPackagePath} for the canonical `/`-joined form.
 */
export function getRegistryPackagePathSegments(packageName: string): readonly string[] {
  if (isScopedPackageName(packageName)) {
    const slash = packageName.indexOf('/');
    const scopeDir = packageName.slice(0, slash);
    const bareName = packageName.slice(slash + 1);
    return ['packages', scopeDir, `${bareName}.json`];
  }
  return ['packages', packageName.charAt(0).toLowerCase(), `${packageName}.json`];
}

/** Canonical `/`-separated repository-relative registry manifest path. */
export function getRegistryPackagePath(packageName: string): string {
  return getRegistryPackagePathSegments(packageName).join('/');
}
