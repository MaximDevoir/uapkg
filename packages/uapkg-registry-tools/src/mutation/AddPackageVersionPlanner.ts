import {
  createRegistryToolsPackageMissingDiagnostic,
  createRegistryToolsPackageSourceMismatchDiagnostic,
  createRegistryToolsPathMismatchDiagnostic,
  createRegistryToolsVersionExistsDiagnostic,
  createSchemaInvalidDiagnostic,
  DiagnosticBag,
  type Result,
} from '@uapkg/diagnostics';
import { type PackageRegistryManifest, type RegistryVersion, RegistryVersionSchema } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.js';
import type {
  AddPackageVersionRequest,
  RegistryMutationPlan,
  ResolvedRegistryToolsPolicy,
} from '../contracts/RegistryToolsTypes.js';
import type { ManifestStore } from '../io/ManifestStore.js';
import type { RegistryRepoPaths } from '../paths/RegistryRepoPaths.js';
import type { DependencyReachabilityValidator } from '../validation/DependencyReachabilityValidator.js';
import type { ExternalRegistryPolicyValidator } from '../validation/ExternalRegistryPolicyValidator.js';
import { sortVersionsNewestFirst } from './VersionSorter.js';

/**
 * Plans the addition of a single package version.
 *
 * Always produces a plan (never throws). Callers inspect the plan's
 * diagnostics — if any are at level `error`, the plan must not be applied.
 */
export class AddPackageVersionPlanner {
  constructor(
    _policy: ResolvedRegistryToolsPolicy,
    private readonly paths: RegistryRepoPaths,
    private readonly store: ManifestStore,
    private readonly externalRegistry: ExternalRegistryPolicyValidator,
    private readonly dependencyReachability: DependencyReachabilityValidator,
    private readonly aggregator: RegistryToolsAggregator,
  ) {
    // The resolved policy is consumed transitively through the validators we compose.
    void _policy;
  }

  async plan(request: AddPackageVersionRequest): Promise<Result<RegistryMutationPlan>> {
    const bag = new DiagnosticBag();
    const manifestPath = this.paths.manifestPath(request.packageName);

    // 1. Validate the version record before doing anything else.
    const versionResult = RegistryVersionSchema.safeParse(request.registryVersion);
    if (!versionResult.success) {
      const issues = versionResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      const diag = createSchemaInvalidDiagnostic(`${request.packageName}@${request.version}`, issues);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    // 2. Load existing manifest, if any.
    const existing = this.store.exists(request.packageName) ? await this.store.read(request.packageName) : null;

    let baseManifest: PackageRegistryManifest;
    let isCreate = false;

    if (existing) {
      if (existing.ok) {
        baseManifest = existing.value;

        // Name mismatch — package on disk identifies as a different name.
        if (baseManifest.name !== request.packageName) {
          const diag = createRegistryToolsPathMismatchDiagnostic(
            request.packageName,
            this.paths.manifestPath(baseManifest.name),
            manifestPath,
          );
          bag.add(diag);
          this.aggregator.add(diag);
        }

        // Source mismatch — protect against accidental source changes.
        if (
          baseManifest.packageSource.type !== request.packageSource.type ||
          baseManifest.packageSource.url !== request.packageSource.url
        ) {
          const diag = createRegistryToolsPackageSourceMismatchDiagnostic(
            request.packageName,
            baseManifest.packageSource,
            request.packageSource,
          );
          bag.add(diag);
          this.aggregator.add(diag);
        }
      } else {
        // Read error other than "missing" — propagate.
        bag.mergeArray(existing.diagnostics);
        return bag.toFailure();
      }
    } else {
      if (!request.createPackageManifestIfMissing) {
        const diag = createRegistryToolsPackageMissingDiagnostic(request.packageName, manifestPath);
        bag.add(diag);
        this.aggregator.add(diag);
        return bag.toFailure();
      }
      isCreate = true;
      baseManifest = {
        name: request.packageName,
        packageSource: request.packageSource,
        versions: {},
      };
    }

    // 3. Duplicate version check.
    const versionsRecord = baseManifest.versions as unknown as Record<string, RegistryVersion>;
    if (versionsRecord[request.version] && !request.overwriteExistingVersion) {
      const diag = createRegistryToolsVersionExistsDiagnostic(request.packageName, request.version);
      bag.add(diag);
      this.aggregator.add(diag);
      // Continue — surface other diagnostics too — but plan will be rejected.
    }

    // 4. Build candidate next manifest.
    const nextVersions: Record<string, RegistryVersion> = {
      ...versionsRecord,
      [request.version]: versionResult.data,
    };
    const sortedKeys = sortVersionsNewestFirst(Object.keys(nextVersions));
    const sortedNextVersions: Record<string, RegistryVersion> = {};
    for (const k of sortedKeys) {
      const v = nextVersions[k];
      if (v) sortedNextVersions[k] = v;
    }

    const nextManifest: PackageRegistryManifest = {
      name: request.packageName,
      packageSource: request.packageSource,
      versions: sortedNextVersions as unknown as PackageRegistryManifest['versions'],
    };

    // 5. External-registry policy on the candidate manifest.
    const ext = this.externalRegistry.validate(nextManifest);
    bag.mergeArray(ext.diagnostics);

    // 6. Dependency reachability on the new version only.
    const dep = await this.dependencyReachability.validate(request.packageName, request.version, versionResult.data);
    bag.mergeArray(dep.diagnostics);

    const operation = isCreate
      ? ({ kind: 'create-manifest', path: manifestPath } as const)
      : ({ kind: 'update-manifest', path: manifestPath } as const);

    return bag.toResult({
      operations: [operation],
      nextManifest,
      diagnostics: bag.all(),
    });
  }
}
