import { join } from 'node:path';
import type { PackageName } from '@uapkg/common-schema';
import { REGISTRY_TOOLS_PACKAGES_DIR } from '../contracts/RegistryToolsTypes.js';

/**
 * Pure path helpers for the registry repo layout used by `@uapkg/registry-tools`.
 *
 * The `cwd` passed in is the root of the registry repo, NOT a package dir.
 * Layout: `{cwd}/packages/{first-letter}/{name}.json`
 */
export class RegistryRepoPaths {
  constructor(private readonly cwd: string) {}

  /** Absolute path to the `packages` directory in the registry repo. */
  packagesDir(): string {
    return join(this.cwd, REGISTRY_TOOLS_PACKAGES_DIR);
  }

  /** Absolute path to the bucket dir for the given package, e.g. `packages/a`. */
  bucketDir(packageName: PackageName): string {
    return join(this.packagesDir(), this.firstLetter(packageName));
  }

  /** Absolute path to a package's manifest JSON file. */
  manifestPath(packageName: PackageName): string {
    return join(this.bucketDir(packageName), `${packageName}.json`);
  }

  /** First lowercase character of the package name; used as the bucket folder. */
  firstLetter(packageName: PackageName): string {
    return packageName.charAt(0).toLowerCase();
  }
}
