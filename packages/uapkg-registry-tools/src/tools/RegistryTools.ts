import { rm } from 'node:fs/promises';
import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import { type Diagnostic, DiagnosticBag, fail, ok, type Result } from '@uapkg/diagnostics';
import type { Integrity, PackageRegistryManifest, RegistryVersion } from '@uapkg/registry-schema';
import { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.js';
import type {
  AddPackageVersionRequest,
  ChangedManifestValidation,
  DependencyValidationReport,
  ExternalRegistryPolicyReport,
  IntegrityAlgorithm,
  IntegrityVerificationResult,
  OfficialPackagePolicyReport,
  PackageSummary,
  RegistryLintReport,
  RegistryMutationPlan,
  RegistryMutationSummary,
  RegistryToolsOptions,
  RegistryValidationReport,
  ReleaseFileNameReport,
  RemovePackageRequest,
  RemovePackageVersionRequest,
  ResolvedRegistryToolsPolicy,
  WriteManifestResult,
} from '../contracts/RegistryToolsTypes.js';
import { IntegrityCalculator } from '../io/IntegrityCalculator.js';
import { ManifestStore } from '../io/ManifestStore.js';
import { PackageLister } from '../listing/PackageLister.js';
import { AddPackageVersionPlanner } from '../mutation/AddPackageVersionPlanner.js';
import { RemovePackagePlanner } from '../mutation/RemovePackagePlanner.js';
import { RemovePackageVersionPlanner } from '../mutation/RemovePackageVersionPlanner.js';
import { RegistryRepoPaths } from '../paths/RegistryRepoPaths.js';
import { DependencyReachabilityValidator } from '../validation/DependencyReachabilityValidator.js';
import { ExternalRegistryPolicyValidator } from '../validation/ExternalRegistryPolicyValidator.js';
import { ManifestValidator } from '../validation/ManifestValidator.js';
import {
  type OfficialRegistryPolicyRequest,
  OfficialRegistryPolicyValidator,
} from '../validation/OfficialRegistryPolicyValidator.js';
import { RegistryValidator } from '../validation/RegistryValidator.js';
import { ReleaseFileNameValidator } from '../validation/ReleaseFileNameValidator.js';

/**
 * Programmatic toolkit for registry-owner workflows over a uapkg registry repo.
 *
 * Always returns `Result<T>`. Never throws for expected failures. Diagnostics
 * are also pushed into a process-wide singleton aggregator (with `once`
 * deduplication) so a CI run can surface a single consolidated list.
 *
 * The `cwd` constructor option is the **registry repo root**, never a package
 * directory inside it.
 */
export class RegistryTools {
  private readonly policy: ResolvedRegistryToolsPolicy;
  private readonly paths: RegistryRepoPaths;
  private readonly aggregator: RegistryToolsAggregator;

  private readonly store: ManifestStore;
  private readonly manifestValidator: ManifestValidator;
  private readonly externalRegistry: ExternalRegistryPolicyValidator;
  private readonly dependencyReachability: DependencyReachabilityValidator;
  private readonly releaseFileNames: ReleaseFileNameValidator;
  private readonly officialPolicy: OfficialRegistryPolicyValidator;
  private readonly integrity: IntegrityCalculator;
  private readonly lister: PackageLister;
  private readonly registryValidator: RegistryValidator;
  private readonly addPlanner: AddPackageVersionPlanner;
  private readonly removeVersionPlanner: RemovePackageVersionPlanner;
  private readonly removePackagePlanner: RemovePackagePlanner;

  constructor(options: RegistryToolsOptions) {
    this.policy = resolvePolicy(options.policy);
    this.paths = new RegistryRepoPaths(options.cwd);
    this.aggregator = RegistryToolsAggregator.getInstance();

    this.store = new ManifestStore(this.paths, this.aggregator);
    this.manifestValidator = new ManifestValidator(this.aggregator);
    this.externalRegistry = new ExternalRegistryPolicyValidator(this.policy, this.aggregator);
    this.dependencyReachability = new DependencyReachabilityValidator(this.policy, this.store, this.aggregator);
    this.releaseFileNames = new ReleaseFileNameValidator(this.aggregator);
    this.officialPolicy = new OfficialRegistryPolicyValidator(this.aggregator);
    this.integrity = new IntegrityCalculator(this.aggregator);
    this.lister = new PackageLister(this.paths, this.store, this.aggregator);
    this.registryValidator = new RegistryValidator(
      this.policy,
      this.paths,
      this.store,
      this.lister,
      this.externalRegistry,
      this.dependencyReachability,
      this.aggregator,
    );
    this.addPlanner = new AddPackageVersionPlanner(
      this.policy,
      this.paths,
      this.store,
      this.externalRegistry,
      this.dependencyReachability,
      this.aggregator,
    );
    this.removeVersionPlanner = new RemovePackageVersionPlanner(this.policy, this.paths, this.store, this.aggregator);
    this.removePackagePlanner = new RemovePackagePlanner(this.policy, this.paths, this.store, this.aggregator);
  }

  // ---------------------------------------------------------------------
  // Read / list
  // ---------------------------------------------------------------------

  getManifestPath(packageName: PackageName): Result<string> {
    return ok(this.paths.manifestPath(packageName));
  }

  readPackageManifest(packageName: PackageName): Promise<Result<PackageRegistryManifest>> {
    return this.store.read(packageName);
  }

  writePackageManifest(manifest: PackageRegistryManifest): Promise<Result<WriteManifestResult>> {
    return this.store.write(manifest);
  }

  packageExists(packageName: PackageName): Result<boolean> {
    return ok(this.store.exists(packageName));
  }

  listPackages(): Promise<Result<PackageSummary[]>> {
    return this.lister.listSummaries();
  }

  async listVersions(packageName: PackageName): Promise<Result<PackageVersion[]>> {
    const read = await this.store.read(packageName);
    if (!read.ok) return read;
    return ok(Object.keys(read.value.versions) as PackageVersion[], read.diagnostics);
  }

  // ---------------------------------------------------------------------
  // Validation / lint
  // ---------------------------------------------------------------------

  validatePackageManifest(manifest: unknown): Result<PackageRegistryManifest> {
    return this.manifestValidator.validate(manifest);
  }

  validateManifestFile(path: string): Promise<Result<PackageRegistryManifest>> {
    return this.store.readFromPath(path);
  }

  validateRegistry(): Promise<Result<RegistryValidationReport>> {
    return this.registryValidator.validateRegistry();
  }

  validatePackages(packageNames: readonly PackageName[]): Promise<Result<RegistryValidationReport>> {
    return this.registryValidator.validatePackages(packageNames);
  }

  async validateChangedManifestFiles(paths: readonly string[]): Promise<Result<ChangedManifestValidation>> {
    const perFile: { path: string; diagnostics: readonly Diagnostic[] }[] = [];
    const overall = new DiagnosticBag();
    for (const path of paths) {
      const r = await this.store.readFromPath(path);
      perFile.push({ path, diagnostics: r.diagnostics });
      overall.mergeArray(r.diagnostics);
    }
    return ok({ perFile }, overall.all());
  }

  async validateDependencyReachability(
    packageName: PackageName,
    version: PackageVersion,
  ): Promise<Result<DependencyValidationReport>> {
    const read = await this.store.read(packageName);
    if (!read.ok) return read;
    const entry = (read.value.versions as unknown as Record<string, RegistryVersion>)[version];
    if (!entry) {
      const bag = new DiagnosticBag();
      bag.mergeArray(read.diagnostics);
      return fail(bag.all());
    }
    return this.dependencyReachability.validate(packageName, version, entry);
  }

  validateExternalRegistryPolicy(manifest: PackageRegistryManifest): Result<ExternalRegistryPolicyReport> {
    return this.externalRegistry.validate(manifest);
  }

  validateReleaseFileNames(
    packageName: PackageName,
    version: PackageVersion,
    fileNames: readonly string[],
  ): Result<ReleaseFileNameReport> {
    return this.releaseFileNames.validate(packageName, version, fileNames);
  }

  validateOfficialRegistryPolicy(request: OfficialRegistryPolicyRequest): Promise<Result<OfficialPackagePolicyReport>> {
    return this.officialPolicy.validate(request);
  }

  /** Run lint-style checks across the whole registry. Currently equivalent to a full validation. */
  async lintRegistry(): Promise<Result<RegistryLintReport>> {
    const r = await this.registryValidator.validateRegistry();
    if (!r.ok) return r;
    return ok({ diagnostics: r.value.diagnostics }, r.diagnostics);
  }

  /** Lint a single in-memory manifest. */
  lintPackageManifest(manifest: PackageRegistryManifest): Result<RegistryLintReport> {
    const ext = this.externalRegistry.validate(manifest);
    return ok({ diagnostics: ext.diagnostics }, ext.diagnostics);
  }

  // ---------------------------------------------------------------------
  // Mutation
  // ---------------------------------------------------------------------

  planAddPackageVersion(request: AddPackageVersionRequest): Promise<Result<RegistryMutationPlan>> {
    return this.addPlanner.plan(request);
  }

  async addPackageVersion(request: AddPackageVersionRequest): Promise<Result<RegistryMutationSummary>> {
    const plan = await this.addPlanner.plan(request);
    if (!plan.ok) return plan;
    return this.applyPlan(plan.value);
  }

  planRemovePackageVersion(request: RemovePackageVersionRequest): Promise<Result<RegistryMutationPlan>> {
    return this.removeVersionPlanner.plan(request);
  }

  async removePackageVersion(request: RemovePackageVersionRequest): Promise<Result<RegistryMutationSummary>> {
    const plan = await this.removeVersionPlanner.plan(request);
    if (!plan.ok) return plan;
    return this.applyPlan(plan.value);
  }

  planRemovePackage(request: RemovePackageRequest): Promise<Result<RegistryMutationPlan>> {
    return this.removePackagePlanner.plan(request);
  }

  async removePackage(request: RemovePackageRequest): Promise<Result<RegistryMutationSummary>> {
    const plan = await this.removePackagePlanner.plan(request);
    if (!plan.ok) return plan;
    return this.applyPlan(plan.value);
  }

  // ---------------------------------------------------------------------
  // Integrity
  // ---------------------------------------------------------------------

  computeFileIntegrity(filePath: string, algorithm?: IntegrityAlgorithm): Promise<Result<Integrity>> {
    return this.integrity.compute(filePath, algorithm);
  }

  verifyFileIntegrity(filePath: string, expected: Integrity): Promise<Result<IntegrityVerificationResult>> {
    return this.integrity.verify(filePath, expected);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async applyPlan(plan: RegistryMutationPlan): Promise<Result<RegistryMutationSummary>> {
    const bag = new DiagnosticBag();
    bag.mergeArray(plan.diagnostics);

    for (const op of plan.operations) {
      if (op.kind === 'delete-manifest') {
        try {
          await rm(op.path, { force: true });
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          bag.addError('IO_ERROR', `Failed to delete ${op.path}: ${reason}`, { path: op.path, reason });
          this.aggregator.addMany(bag.all());
          return bag.toFailure();
        }
      } else if (plan.nextManifest) {
        const write = await this.store.write(plan.nextManifest);
        if (!write.ok) {
          bag.mergeArray(write.diagnostics);
          return bag.toFailure();
        }
      }
    }

    return ok(
      {
        operations: plan.operations,
        diagnostics: bag.all(),
      },
      bag.all(),
    );
  }
}

function resolvePolicy(policy: RegistryToolsOptions['policy']): ResolvedRegistryToolsPolicy {
  return {
    externalRegistries: policy?.externalRegistries ?? 'deny',
    allowedExternalRegistryNames: policy?.allowedExternalRegistryNames ?? [],
    removals: policy?.removals ?? 'deny',
    unknownKeys: policy?.unknownKeys ?? 'warn',
    requireExistingDependencies: policy?.requireExistingDependencies ?? true,
    requireReachableDependencyRanges: policy?.requireReachableDependencyRanges ?? true,
    requireSortedVersions: policy?.requireSortedVersions ?? true,
  };
}
