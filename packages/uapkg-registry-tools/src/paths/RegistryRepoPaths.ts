import { join } from 'node:path';
import type { PackageName } from '@uapkg/common-schema';
import { getRegistryPackagePathSegments } from '@uapkg/registry-schema';
import { REGISTRY_TOOLS_PACKAGES_DIR } from '../contracts/RegistryToolsTypes.js';

/**
 * Pure path helpers for the registry repo layout used by `@uapkg/registry-tools`.
 *
 * The `cwd` passed in is the root of the registry repo, NOT a package dir.
 * Layout: `{cwd}/packages/{first-letter}/{name}.json` for unscoped names and
 * `{cwd}/packages/@{scope}/{name}.json` for scoped names.
 */
export class RegistryRepoPaths {
  constructor(private readonly cwd: string) {}

  /** Absolute path to the `packages` directory in the registry repo. */
  packagesDir(): string {
    return join(this.cwd, REGISTRY_TOOLS_PACKAGES_DIR);
  }

  /** Absolute path to the bucket dir for the given package, e.g. `packages/a` or `packages/@acme`. */
  bucketDir(packageName: PackageName): string {
    const segments = getRegistryPackagePathSegments(packageName);
    return join(this.cwd, ...segments.slice(0, -1));
  }

  /** Absolute path to a package's manifest JSON file. */
  manifestPath(packageName: PackageName): string {
    return join(this.cwd, ...getRegistryPackagePathSegments(packageName));
  }

  /** Bucket folder name: the scope directory for scoped names, else the first lowercase character. */
  firstLetter(packageName: PackageName): string {
    const segments = getRegistryPackagePathSegments(packageName);
    return segments[segments.length - 2];
  }
}
