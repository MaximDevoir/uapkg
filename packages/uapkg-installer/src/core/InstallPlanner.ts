import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AssetHash, InstallPath, PackageName, PackageVersion, RegistryName } from '@uapkg/common-schema';
import { DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import type { Lockfile } from '@uapkg/package-manifest-schema';
import { getRegistryRepoPath, type RegistryCore } from '@uapkg/registry-core';
import type { RegistryVersion } from '@uapkg/registry-schema';
import type { InstallAction, InstallPlan, InstallSummary } from '../contracts/InstallerTypes.js';
import type { DiskStateEntry } from './DiskStateInspector.js';

/**
 * Diffs (previousLockfile, currentLockfile, diskState) → InstallPlan.
 *
 * Rules:
 *  - Package in current lockfile, not on disk        → `add`
 *  - Package in current lockfile, on disk, same ver  → `unchanged`
 *  - Package in current lockfile, on disk, different → `update`
 *  - Package in previous lockfile only                → `remove`
 *
 * Fetches asset URLs + integrity + size + the registry version record (for
 * install-time claims verification) from `RegistryCore` for add/update
 * actions. Pure with respect to disk (planner only reads registry metadata).
 */
export class InstallPlanner {
  constructor(private readonly registryCore: RegistryCore) {}

  async plan(
    currentLockfile: Lockfile,
    previousLockfile: Lockfile | null,
    diskState: ReadonlyMap<PackageName, DiskStateEntry>,
  ): Promise<Result<InstallPlan>> {
    const bag = new DiagnosticBag();
    const actions: InstallAction[] = [];
    let totalBytes = 0;

    const current = currentLockfile.packages as Record<string, LockEntry>;
    const previous = previousLockfile?.packages as Record<string, LockEntry> | undefined;

    for (const [rawName, locked] of Object.entries(current)) {
      const name = rawName as PackageName;
      const state = diskState.get(name);
      const defaultPath = `Plugins/${name}` as unknown as InstallPath;
      const path = state?.path ?? defaultPath;

      if (!state?.exists || !state.hasManifest || state.installedName !== name) {
        const meta = await this.fetchAssetMeta(locked, name);
        if (!meta.ok) {
          bag.mergeArray(meta.diagnostics);
          continue;
        }
        if (meta.value.sizeBytes) totalBytes += meta.value.sizeBytes;
        actions.push({
          type: 'add',
          packageName: name,
          path,
          targetVersion: locked.version,
          registry: locked.registry,
          integrity: locked.integrity,
          sizeBytes: meta.value.sizeBytes,
          downloadUrl: meta.value.downloadUrl,
          registryEntry: meta.value.registryEntry,
          registryType: meta.value.registryType,
        });
        continue;
      }

      if (state.installedVersion !== locked.version) {
        const meta = await this.fetchAssetMeta(locked, name);
        if (!meta.ok) {
          bag.mergeArray(meta.diagnostics);
          continue;
        }
        if (meta.value.sizeBytes) totalBytes += meta.value.sizeBytes;
        actions.push({
          type: 'update',
          packageName: name,
          path,
          targetVersion: locked.version,
          currentVersion: state.installedVersion,
          registry: locked.registry,
          integrity: locked.integrity,
          sizeBytes: meta.value.sizeBytes,
          downloadUrl: meta.value.downloadUrl,
          registryEntry: meta.value.registryEntry,
          registryType: meta.value.registryType,
        });
        continue;
      }

      actions.push({
        type: 'unchanged',
        packageName: name,
        path,
        targetVersion: locked.version,
        registry: locked.registry,
      });
    }

    // Removals (in previous but not in current)
    if (previous) {
      for (const rawName of Object.keys(previous)) {
        if (rawName in current) continue;
        const name = rawName as PackageName;
        const state = diskState.get(name);
        actions.push({
          type: 'remove',
          packageName: name,
          path: state?.path ?? (`Plugins/${name}` as unknown as InstallPath),
          currentVersion: previous[rawName].version,
        });
      }
    }

    const summary = this.summarize(actions, totalBytes);
    if (bag.hasErrors()) return bag.toFailure();
    return ok({ actions, summary });
  }

  private summarize(actions: readonly InstallAction[], totalBytes: number): InstallSummary {
    let added = 0,
      updated = 0,
      removed = 0,
      unchanged = 0;
    for (const a of actions) {
      if (a.type === 'add') added++;
      else if (a.type === 'update') updated++;
      else if (a.type === 'remove') removed++;
      else unchanged++;
    }
    return { added, updated, removed, unchanged, totalBytes };
  }

  private async fetchAssetMeta(
    locked: LockEntry,
    name: PackageName,
  ): Promise<
    Result<{
      readonly downloadUrl: string;
      readonly sizeBytes?: number;
      readonly registryEntry: RegistryVersion;
      readonly registryType?: 'public' | 'private';
    }>
  > {
    const bag = new DiagnosticBag();
    const registryResult = this.registryCore.getOrCreateRegistry(locked.registry);
    if (!registryResult.ok) {
      bag.mergeArray(registryResult.diagnostics);
      return bag.toFailure();
    }
    const pkgManifest = await registryResult.value.getPackageManifest(name, locked.registry);
    if (!pkgManifest.ok) {
      bag.mergeArray(pkgManifest.diagnostics);
      return bag.toFailure();
    }
    const versionEntry = (pkgManifest.value.versions as Record<string, RegistryVersion>)[
      locked.version as unknown as string
    ];
    if (!versionEntry) {
      bag.addError(
        'INSTALL_VERSION_NOT_IN_REGISTRY',
        `Version ${locked.version} of "${name}" is not present in registry "${locked.registry}".`,
        { packageName: name, version: locked.version, registry: locked.registry },
      );
      return bag.toFailure();
    }
    return ok({
      downloadUrl: versionEntry.releaseFiles.package.url,
      sizeBytes: versionEntry.releaseFiles.package.integrity.size,
      registryEntry: versionEntry,
      registryType: await this.readRegistryType(registryResult.value.shortId),
    });
  }

  /**
   * Read the immutable registry type from the projected registry metadata.
   * Absent files or fields yield undefined, which install verification treats
   * with private-registry semantics (comparison only, no public policy rule).
   */
  private async readRegistryType(shortId: string): Promise<'public' | 'private' | undefined> {
    const metaPath = join(getRegistryRepoPath(shortId), '.uapkg', 'registry.meta.json');
    if (!existsSync(metaPath)) return undefined;
    try {
      const raw = await readFile(metaPath, 'utf8');
      const parsed = JSON.parse(raw) as { registry?: { registryType?: unknown } };
      const value = parsed.registry?.registryType;
      return value === 'public' || value === 'private' ? value : undefined;
    } catch {
      return undefined;
    }
  }
}

// Local aliases — avoid importing schema types directly to keep this file small.
interface LockEntry {
  readonly version: PackageVersion;
  readonly registry: RegistryName;
  readonly integrity: AssetHash;
  readonly path?: InstallPath;
}

// biome-ignore lint: TODO: review if no longer used after refactor
interface RegistryVersionShape {
  readonly releaseFiles: {
    readonly package: { readonly url: string; readonly integrity: { readonly size: number } };
  };
}
