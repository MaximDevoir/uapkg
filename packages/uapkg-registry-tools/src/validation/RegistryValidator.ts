import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import {
  createRegistryToolsPathMismatchDiagnostic,
  createRegistryToolsVersionsUnsortedDiagnostic,
  DiagnosticBag,
  ok,
  type Result,
} from '@uapkg/diagnostics';
import type { PackageRegistryManifest } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type {
  PackageValidationReport,
  RegistryValidationReport,
  ResolvedRegistryToolsPolicy,
} from '../contracts/RegistryToolsTypes.ts';
import type { ManifestStore } from '../io/ManifestStore.ts';
import type { PackageLister } from '../listing/PackageLister.ts';
import { sortVersionsNewestFirst } from '../mutation/VersionSorter.ts';
import type { RegistryRepoPaths } from '../paths/RegistryRepoPaths.ts';
import type { DependencyReachabilityValidator } from './DependencyReachabilityValidator.ts';
import type { ExternalRegistryPolicyValidator } from './ExternalRegistryPolicyValidator.ts';

/**
 * High-level validator that runs every cross-cutting check across one or more
 * packages in the registry. Composes per-concern validators rather than doing
 * the work itself (SRP).
 */
export class RegistryValidator {
  constructor(
    private readonly policy: ResolvedRegistryToolsPolicy,
    private readonly paths: RegistryRepoPaths,
    private readonly store: ManifestStore,
    private readonly lister: PackageLister,
    private readonly externalRegistry: ExternalRegistryPolicyValidator,
    private readonly dependencyReachability: DependencyReachabilityValidator,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  async validateRegistry(): Promise<Result<RegistryValidationReport>> {
    const namesResult = await this.lister.listPackageNames();
    if (!namesResult.ok) {
      return namesResult;
    }
    return this.validatePackages(namesResult.value);
  }

  async validatePackages(packageNames: readonly PackageName[]): Promise<Result<RegistryValidationReport>> {
    const reports: PackageValidationReport[] = [];
    const overall = new DiagnosticBag();

    for (const name of packageNames) {
      const report = await this.validateSinglePackage(name);
      reports.push(report);
      overall.mergeArray(report.diagnostics);
    }

    return ok(
      {
        packageReports: reports,
        diagnostics: overall.all(),
      },
      overall.all(),
    );
  }

  async validateSinglePackage(packageName: PackageName): Promise<PackageValidationReport> {
    const manifestPath = this.store.resolveManifestPath(packageName);
    const bag = new DiagnosticBag();

    const read = await this.store.read(packageName);
    if (!read.ok) {
      bag.mergeArray(read.diagnostics);
      return { packageName, manifestPath, diagnostics: bag.all() };
    }

    const manifest = read.value;

    // Path/name mismatch
    if (manifest.name !== packageName) {
      const expected = this.paths.manifestPath(manifest.name);
      const actual = manifestPath;
      const diag = createRegistryToolsPathMismatchDiagnostic(packageName, expected, actual);
      bag.add(diag);
      this.aggregator.add(diag);
    }

    // Version sort order
    if (this.policy.requireSortedVersions) {
      this.checkVersionsSorted(bag, manifest);
    }

    // External registry policy
    const ext = this.externalRegistry.validate(manifest);
    bag.mergeArray(ext.diagnostics);

    // Dependency reachability per version
    for (const [version, entry] of Object.entries(manifest.versions)) {
      if (!entry) continue;
      const dep = await this.dependencyReachability.validate(packageName, version as PackageVersion, entry);
      bag.mergeArray(dep.diagnostics);
    }

    return { packageName, manifestPath, diagnostics: bag.all() };
  }

  private checkVersionsSorted(bag: DiagnosticBag, manifest: PackageRegistryManifest): void {
    const actual = Object.keys(manifest.versions);
    const expected = sortVersionsNewestFirst(actual);
    const isSorted = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
    if (!isSorted) {
      const diag = createRegistryToolsVersionsUnsortedDiagnostic(manifest.name, actual, expected);
      bag.add(diag);
      this.aggregator.add(diag);
    }
  }
}
