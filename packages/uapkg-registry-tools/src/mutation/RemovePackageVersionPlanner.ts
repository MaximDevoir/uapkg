import {
  createRegistryToolsRemovalDeniedDiagnostic,
  createRegistryToolsVersionNotFoundDiagnostic,
  DiagnosticBag,
  type Result,
} from '@uapkg/diagnostics';
import type { PackageRegistryManifest, RegistryVersion } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type {
  RegistryMutationPlan,
  RemovePackageVersionRequest,
  ResolvedRegistryToolsPolicy,
} from '../contracts/RegistryToolsTypes.ts';
import type { ManifestStore } from '../io/ManifestStore.ts';
import type { RegistryRepoPaths } from '../paths/RegistryRepoPaths.ts';

/**
 * Plans the removal of a single version from a package.
 *
 * Honors `policy.removals` — by default, removals are denied.
 */
export class RemovePackageVersionPlanner {
  constructor(
    private readonly policy: ResolvedRegistryToolsPolicy,
    private readonly paths: RegistryRepoPaths,
    private readonly store: ManifestStore,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  async plan(request: RemovePackageVersionRequest): Promise<Result<RegistryMutationPlan>> {
    const bag = new DiagnosticBag();
    const manifestPath = this.paths.manifestPath(request.packageName);

    if (this.policy.removals === 'deny') {
      const diag = createRegistryToolsRemovalDeniedDiagnostic(
        'version',
        request.packageName,
        this.policy.removals,
        request.version,
      );
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    const read = await this.store.read(request.packageName);
    if (!read.ok) {
      bag.mergeArray(read.diagnostics);
      return bag.toFailure();
    }

    const manifest = read.value;
    const versions = manifest.versions as unknown as Record<string, RegistryVersion>;

    if (!versions[request.version]) {
      const diag = createRegistryToolsVersionNotFoundDiagnostic(request.packageName, request.version);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    const nextVersions: Record<string, RegistryVersion> = { ...versions };
    delete nextVersions[request.version];

    const nextManifest: PackageRegistryManifest = {
      name: manifest.name,
      packageSource: manifest.packageSource,
      versions: nextVersions as unknown as PackageRegistryManifest['versions'],
    };

    return bag.toResult({
      operations: [{ kind: 'update-manifest', path: manifestPath }],
      nextManifest,
      diagnostics: bag.all(),
    });
  }
}
