import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeJsonParse } from '@uapkg/common';
import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import { createRegistryToolsOfficialPolicyViolationDiagnostic, DiagnosticBag, type Result } from '@uapkg/diagnostics';
import { BaseManifestSchema } from '@uapkg/package-manifest-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type { OfficialPackagePolicyReport } from '../contracts/RegistryToolsTypes.ts';

const UAPKG_MANIFEST = 'uapkg.json';
const UAPKG_LOCKFILE = 'uapkg.lock';

export interface OfficialRegistryPolicyRequest {
  /** Absolute path to the extracted package's root directory. */
  readonly extractedPackageDir: string;
  readonly expectedPackageName: PackageName;
  readonly expectedVersion: PackageVersion;
}

/**
 * Local-only validator for "official registry" rules on an already-extracted
 * package directory.
 *
 * Rules:
 *  - `uapkg.json` must exist.
 *  - `uapkg.json#name` must match the registry-declared package name.
 *  - `uapkg.json#version` must match the registry-declared version.
 *  - `uapkg.json#private: true` is rejected.
 *  - `uapkg.lock` must not be present.
 *  - Dependencies must not target external registries.
 *
 * Never makes network calls. Never checks publish authority.
 */
export class OfficialRegistryPolicyValidator {
  constructor(private readonly aggregator: RegistryToolsAggregator) {}

  async validate(request: OfficialRegistryPolicyRequest): Promise<Result<OfficialPackagePolicyReport>> {
    const bag = new DiagnosticBag();
    const dir = request.extractedPackageDir;
    const manifestPath = join(dir, UAPKG_MANIFEST);

    if (!existsSync(manifestPath)) {
      this.report(bag, 'manifest-missing', `Missing ${UAPKG_MANIFEST} in extracted package`, manifestPath);
      return bag.toFailure();
    }

    const lockPath = join(dir, UAPKG_LOCKFILE);
    if (existsSync(lockPath)) {
      this.report(bag, 'lockfile-forbidden', `${UAPKG_LOCKFILE} must not be packaged`, lockPath);
    }

    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf-8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.report(bag, 'manifest-unreadable', reason, manifestPath);
      return bag.toFailure();
    }

    const parsed = safeJsonParse<unknown>(raw, manifestPath);
    if (!parsed.ok) {
      bag.mergeArray(parsed.diagnostics);
      this.aggregator.addMany(parsed.diagnostics);
      return bag.toFailure();
    }

    const validated = BaseManifestSchema.safeParse(parsed.value);
    if (!validated.success) {
      const detail = validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.report(bag, 'manifest-invalid', detail, manifestPath);
      return bag.toFailure();
    }

    const manifest = validated.data;

    if (manifest.private === true) {
      this.report(bag, 'private-package', '`private: true` packages are not publishable', manifestPath);
    }

    if (manifest.name !== request.expectedPackageName) {
      this.report(
        bag,
        'name-mismatch',
        `manifest name "${manifest.name}" does not match registry name "${request.expectedPackageName}"`,
        manifestPath,
      );
    }

    if (manifest.version !== request.expectedVersion) {
      this.report(
        bag,
        'version-mismatch',
        `manifest version "${manifest.version}" does not match registry version "${request.expectedVersion}"`,
        manifestPath,
      );
    }

    this.checkExternalDeps(bag, manifest.dependencies, 'dependencies', manifestPath);
    this.checkExternalDeps(bag, manifest.devDependencies, 'devDependencies', manifestPath);
    this.checkExternalDeps(bag, manifest.peerDependencies, 'peerDependencies', manifestPath);

    return bag.toResult({ diagnostics: bag.all() });
  }

  private checkExternalDeps(
    bag: DiagnosticBag,
    deps: Record<string, { readonly registry?: string }> | undefined,
    bucket: 'dependencies' | 'devDependencies' | 'peerDependencies',
    manifestPath: string,
  ): void {
    if (!deps) return;
    for (const [name, dep] of Object.entries(deps)) {
      if (dep && typeof dep === 'object' && dep.registry) {
        this.report(
          bag,
          'external-registry-dependency',
          `dependency "${name}" in ${bucket} targets external registry "${dep.registry}"`,
          manifestPath,
        );
      }
    }
  }

  private report(bag: DiagnosticBag, rule: string, detail: string, path?: string): void {
    const diag = createRegistryToolsOfficialPolicyViolationDiagnostic(rule, detail, path);
    bag.add(diag);
    this.aggregator.add(diag);
  }
}
