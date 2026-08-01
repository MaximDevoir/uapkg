import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import type { RegistryIdentifier, UnixTimestamp } from '@uapkg/common-schema';
import {
  createCacheCorruptDiagnostic,
  createCacheIdentifierCollisionDiagnostic,
  createCacheReadErrorDiagnostic,
  fail,
  ok,
  type Result,
} from '@uapkg/diagnostics';
import { getRegistryCachePath, getRegistryMetadataPath, getRegistryRepoPath } from '../paths/RegistryPaths.js';
import type { RegistryMetadataReader } from './RegistryMetadataReader.js';

export interface RegistryCacheState {
  readonly initialized: boolean;
  readonly lastRegistrySyncAt?: UnixTimestamp;
}

/**
 * Validates the relationship between a shortened cache directory, its cloned
 * repository, and the full identity retained in registry.json.
 */
export class RegistryCacheValidator {
  constructor(
    private readonly shortId: string,
    private readonly expectedIdentifier: RegistryIdentifier,
    private readonly metadataReader: RegistryMetadataReader,
  ) {}

  async inspect(): Promise<Result<RegistryCacheState>> {
    const cachePath = getRegistryCachePath(this.shortId);
    const metadataPath = getRegistryMetadataPath(this.shortId);
    const repoPath = getRegistryRepoPath(this.shortId);

    if (!existsSync(cachePath)) {
      return ok({ initialized: false });
    }

    let entries: string[];
    try {
      entries = await readdir(cachePath);
    } catch (err) {
      return fail([createCacheReadErrorDiagnostic(cachePath, String(err))]);
    }

    const metadataExists = existsSync(metadataPath);
    const repoExists = existsSync(repoPath);

    if (!metadataExists && !repoExists) {
      const cacheEntries = entries.filter((entry) => entry !== '.lock');
      if (cacheEntries.length === 0) {
        return ok({ initialized: false });
      }

      return fail([
        createCacheCorruptDiagnostic(
          cachePath,
          'the cache contains data but has neither registry.json metadata nor a cloned registry repository',
        ),
      ]);
    }

    if (!metadataExists) {
      return fail([
        createCacheCorruptDiagnostic(cachePath, 'the cloned registry repository has no registry.json metadata'),
      ]);
    }

    if (!repoExists) {
      return fail([
        createCacheCorruptDiagnostic(cachePath, 'registry.json exists but the cloned registry repository is missing'),
      ]);
    }

    try {
      const [metadataStats, repoStats] = await Promise.all([stat(metadataPath), stat(repoPath)]);
      if (!metadataStats.isFile()) {
        return fail([createCacheCorruptDiagnostic(cachePath, 'registry.json is not a regular file')]);
      }
      if (!repoStats.isDirectory()) {
        return fail([createCacheCorruptDiagnostic(cachePath, 'the cloned registry repository is not a directory')]);
      }
    } catch (err) {
      return fail([createCacheReadErrorDiagnostic(cachePath, String(err))]);
    }

    const metadataResult = await this.metadataReader.read();
    if (!metadataResult.ok) return metadataResult;

    if (metadataResult.value.registryIdentifier !== this.expectedIdentifier) {
      return fail([
        createCacheIdentifierCollisionDiagnostic(
          cachePath,
          this.expectedIdentifier,
          metadataResult.value.registryIdentifier,
        ),
      ]);
    }

    return ok({
      initialized: true,
      lastRegistrySyncAt: metadataResult.value.lastRegistrySyncAt,
    });
  }
}
