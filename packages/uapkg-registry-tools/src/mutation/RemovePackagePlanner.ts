import { createRegistryToolsRemovalDeniedDiagnostic, DiagnosticBag, type Result } from '@uapkg/diagnostics';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type {
  RegistryMutationPlan,
  RemovePackageRequest,
  ResolvedRegistryToolsPolicy,
} from '../contracts/RegistryToolsTypes.ts';
import type { ManifestStore } from '../io/ManifestStore.ts';
import type { RegistryRepoPaths } from '../paths/RegistryRepoPaths.ts';

/**
 * Plans the deletion of a package's manifest entirely.
 *
 * Requires `policy.removals === 'allow-package-remove'`. Any weaker setting
 * blocks the plan.
 */
export class RemovePackagePlanner {
  constructor(
    private readonly policy: ResolvedRegistryToolsPolicy,
    private readonly paths: RegistryRepoPaths,
    private readonly store: ManifestStore,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  async plan(request: RemovePackageRequest): Promise<Result<RegistryMutationPlan>> {
    const bag = new DiagnosticBag();
    const manifestPath = this.paths.manifestPath(request.packageName);

    if (this.policy.removals !== 'allow-package-remove') {
      const diag = createRegistryToolsRemovalDeniedDiagnostic('package', request.packageName, this.policy.removals);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    const read = await this.store.read(request.packageName);
    if (!read.ok) {
      bag.mergeArray(read.diagnostics);
      return bag.toFailure();
    }

    return bag.toResult({
      operations: [{ kind: 'delete-manifest', path: manifestPath }],
      diagnostics: bag.all(),
    });
  }
}
