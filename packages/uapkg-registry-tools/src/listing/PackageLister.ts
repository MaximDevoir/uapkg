import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { PackageName } from '@uapkg/common-schema';
import { createIoErrorDiagnostic, DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.js';
import type { PackageSummary } from '../contracts/RegistryToolsTypes.js';
import type { ManifestStore } from '../io/ManifestStore.js';
import type { RegistryRepoPaths } from '../paths/RegistryRepoPaths.js';

/**
 * Lists packages in the registry repo by walking `packages/{first-letter}/*.json`.
 */
export class PackageLister {
  constructor(
    private readonly paths: RegistryRepoPaths,
    private readonly store: ManifestStore,
    private readonly aggregator: RegistryToolsAggregator,
  ) {}

  /** All package names in the registry repo, sorted alphabetically. */
  async listPackageNames(): Promise<Result<PackageName[]>> {
    const bag = new DiagnosticBag();
    const root = this.paths.packagesDir();
    if (!existsSync(root)) {
      return ok([], bag.all());
    }

    let buckets: string[];
    try {
      buckets = await readdir(root);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const diag = createIoErrorDiagnostic(root, reason);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    const names: string[] = [];
    for (const bucket of buckets) {
      const bucketPath = join(root, bucket);
      let entries: string[];
      try {
        entries = await readdir(bucketPath);
      } catch {
        continue; // skip non-directory entries silently
      }
      for (const entry of entries) {
        if (extname(entry).toLowerCase() === '.json') {
          names.push(entry.slice(0, -'.json'.length));
        }
      }
    }

    names.sort();
    return ok(names as PackageName[], bag.all());
  }

  /** Summaries (manifest path + version count) for every package. */
  async listSummaries(): Promise<Result<PackageSummary[]>> {
    const namesResult = await this.listPackageNames();
    if (!namesResult.ok) return namesResult;

    const summaries: PackageSummary[] = [];
    const aggregateBag = new DiagnosticBag();

    for (const name of namesResult.value) {
      const manifestPath = this.store.resolveManifestPath(name);
      const read = await this.store.read(name);
      if (!read.ok) {
        aggregateBag.mergeArray(read.diagnostics);
        continue;
      }
      summaries.push({
        name,
        manifestPath,
        versionCount: Object.keys(read.value.versions).length,
      });
    }

    return ok(summaries, aggregateBag.all());
  }
}
