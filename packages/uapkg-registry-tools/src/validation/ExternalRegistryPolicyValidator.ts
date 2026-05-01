import {
  createRegistryToolsExternalRegistryDeniedDiagnostic,
  createRegistryToolsExternalRegistryNotAllowedDiagnostic,
  DiagnosticBag,
  type Result,
} from '@uapkg/diagnostics';
import type { PackageRegistryManifest, RegistryDependency } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.js';
import type { ExternalRegistryPolicyReport, ResolvedRegistryToolsPolicy } from '../contracts/RegistryToolsTypes.js';

type Bucket = 'dependencies' | 'devDependencies' | 'peerDependencies';

/**
 * Enforces the external-registry policy on every dependency record of every
 * version inside a package manifest.
 *
 * "External" means a dependency record whose normalized `registry` field is
 * set. Records without a `registry` field belong to this registry and are
 * intentionally untouched here.
 */
export class ExternalRegistryPolicyValidator {
  constructor(
    private readonly policy: ResolvedRegistryToolsPolicy,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  validate(manifest: PackageRegistryManifest): Result<ExternalRegistryPolicyReport> {
    const bag = new DiagnosticBag();

    for (const [version, entry] of Object.entries(manifest.versions)) {
      if (!entry) continue;
      this.checkBucket(bag, manifest.name, version, 'dependencies', entry.dependencies);
      this.checkBucket(bag, manifest.name, version, 'devDependencies', entry.devDependencies);
      this.checkBucket(bag, manifest.name, version, 'peerDependencies', entry.peerDependencies);
    }

    return bag.toResult({ diagnostics: bag.all() } satisfies ExternalRegistryPolicyReport);
  }

  private checkBucket(
    bag: DiagnosticBag,
    packageName: string,
    version: string,
    bucket: Bucket,
    deps: Record<string, RegistryDependency> | undefined,
  ): void {
    if (!deps) return;
    for (const [dependency, dep] of Object.entries(deps)) {
      const registryName = dep.registry;
      if (!registryName) continue; // in-registry dep, not external

      if (this.policy.externalRegistries === 'allow-any') continue;

      if (this.policy.externalRegistries === 'deny') {
        const diag = createRegistryToolsExternalRegistryDeniedDiagnostic({
          packageName,
          version,
          dependency,
          registryName,
          bucket,
        });
        bag.add(diag);
        this.aggregator.add(diag);
        continue;
      }

      // allow-listed
      if (!this.policy.allowedExternalRegistryNames.includes(registryName)) {
        const diag = createRegistryToolsExternalRegistryNotAllowedDiagnostic({
          packageName,
          version,
          dependency,
          registryName,
          allowList: this.policy.allowedExternalRegistryNames,
          bucket,
        });
        bag.add(diag);
        this.aggregator.add(diag);
      }
    }
  }
}
