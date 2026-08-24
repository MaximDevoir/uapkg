import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import {
  createRegistryToolsDependencyNotInRegistryDiagnostic,
  createRegistryToolsDependencyRangeUnreachableDiagnostic,
  DiagnosticBag,
  type Result,
} from '@uapkg/diagnostics';
import type { RegistryDependency, RegistryVersion } from '@uapkg/registry-schema';
import { satisfies } from 'semver';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type { DependencyValidationReport, ResolvedRegistryToolsPolicy } from '../contracts/RegistryToolsTypes.ts';
import type { ManifestStore } from '../io/ManifestStore.ts';

/**
 * Verifies that the in-registry (non-external) dependencies of a single
 * registry version both **exist** in the registry and have at least one
 * published version that satisfies their declared range.
 *
 * Only `dependencies` are checked. `devDependencies` and `peerDependencies` are
 * intentionally not enforced here (per spec).
 */
export class DependencyReachabilityValidator {
  constructor(
    private readonly policy: ResolvedRegistryToolsPolicy,
    private readonly store: ManifestStore,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  async validate(
    packageName: PackageName,
    version: PackageVersion,
    registryVersion: RegistryVersion,
  ): Promise<Result<DependencyValidationReport>> {
    const bag = new DiagnosticBag();

    if (!this.policy.requireExistingDependencies && !this.policy.requireReachableDependencyRanges) {
      return bag.toResult({ packageName, version, diagnostics: bag.all() });
    }

    const deps = registryVersion.dependencies ?? {};

    for (const [dependency, dep] of Object.entries(deps) as [string, RegistryDependency][]) {
      if (dep.registry) continue; // external — not our concern here

      const target = await this.store.read(dependency as PackageName);

      if (!target.ok) {
        if (this.policy.requireExistingDependencies) {
          const diag = createRegistryToolsDependencyNotInRegistryDiagnostic(packageName, version, dependency);
          bag.add(diag);
          this.aggregator.add(diag);
        }
        continue;
      }

      if (!this.policy.requireReachableDependencyRanges) continue;

      const available = Object.keys(target.value.versions);
      const matches = available.some((v) => safeSatisfies(v, dep.version));
      if (!matches) {
        const diag = createRegistryToolsDependencyRangeUnreachableDiagnostic(
          packageName,
          version,
          dependency,
          dep.version,
          available,
        );
        bag.add(diag);
        this.aggregator.add(diag);
      }
    }

    return bag.toResult({ packageName, version, diagnostics: bag.all() });
  }
}

function safeSatisfies(version: string, range: string): boolean {
  try {
    return satisfies(version, range);
  } catch {
    return false;
  }
}
