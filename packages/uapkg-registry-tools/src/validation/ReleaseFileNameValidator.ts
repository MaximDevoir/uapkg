import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import { createRegistryToolsReleaseFileNameInvalidDiagnostic, DiagnosticBag, type Result } from '@uapkg/diagnostics';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type { ReleaseFileNameReport } from '../contracts/RegistryToolsTypes.ts';

/**
 * Validates that release file names follow one of the accepted shapes.
 *
 * Accepted file names for `{packageName}@{version}`:
 *   - `package.tgz`
 *   - `${packageName}.tgz`
 *   - `${packageName}@${version}.tgz`
 */
export class ReleaseFileNameValidator {
  constructor(private readonly aggregator: RegistryToolsAggregator) {}

  validate(
    packageName: PackageName,
    version: PackageVersion,
    fileNames: readonly string[],
  ): Result<ReleaseFileNameReport> {
    const bag = new DiagnosticBag();
    const accepted = this.acceptedNames(packageName, version);

    for (const name of fileNames) {
      if (!accepted.includes(name)) {
        const diag = createRegistryToolsReleaseFileNameInvalidDiagnostic(packageName, version, name, accepted);
        bag.add(diag);
        this.aggregator.add(diag);
      }
    }

    return bag.toResult({ diagnostics: bag.all() });
  }

  acceptedNames(packageName: PackageName, version: PackageVersion): readonly string[] {
    return ['package.tgz', `${packageName}.tgz`, `${packageName}@${version}.tgz`];
  }
}
