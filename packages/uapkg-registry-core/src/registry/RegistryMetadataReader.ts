import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { RegistryIdentifier, UnixTimestamp } from '@uapkg/common-schema';
import {
  createCacheCorruptDiagnostic,
  createCacheReadErrorDiagnostic,
  createIoErrorDiagnostic,
  fail,
  ok,
  type Result,
} from '@uapkg/diagnostics';
import type { RegistryMetadata } from '../contracts/RegistryCoreTypes.ts';
import { getRegistryMetadataPath } from '../paths/RegistryPaths.ts';

/**
 * Read and write `registry.json` metadata for a local registry cache.
 */
export class RegistryMetadataReader {
  constructor(private readonly shortId: string) {}

  /** Read registry.json from cache. */
  async read(): Promise<Result<RegistryMetadata>> {
    const metaPath = getRegistryMetadataPath(this.shortId);
    let raw: string;
    try {
      raw = await readFile(metaPath, 'utf-8');
    } catch (err) {
      return fail([createCacheReadErrorDiagnostic(metaPath, String(err))]);
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return fail([createCacheCorruptDiagnostic(metaPath, `registry.json is not valid JSON (${String(err)})`)]);
    }

    const invalidReason = validateRegistryMetadata(data);
    if (invalidReason) {
      return fail([createCacheCorruptDiagnostic(metaPath, invalidReason)]);
    }

    const metadata = data as Record<string, unknown>;
    return ok({
      lastRegistrySyncAt: metadata.lastRegistrySyncAt as UnixTimestamp,
      registryIdentifier: metadata.registryIdentifier as RegistryIdentifier,
    });
  }

  /** Write updated registry.json to cache. */
  async write(metadata: RegistryMetadata): Promise<Result<void>> {
    const metaPath = getRegistryMetadataPath(this.shortId);
    try {
      const dir = metaPath.replace(/[/\\][^/\\]+$/, '');
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
      return ok(undefined);
    } catch (err) {
      return fail([createIoErrorDiagnostic(metaPath, String(err))]);
    }
  }

  /** Check whether registry.json exists in cache. */
  exists(): boolean {
    return existsSync(getRegistryMetadataPath(this.shortId));
  }
}

function validateRegistryMetadata(data: unknown): string | null {
  if (!isRecord(data)) {
    return 'registry.json must contain a JSON object';
  }

  if (
    typeof data.lastRegistrySyncAt !== 'number' ||
    !Number.isSafeInteger(data.lastRegistrySyncAt) ||
    data.lastRegistrySyncAt < 0
  ) {
    return '"lastRegistrySyncAt" must be a non-negative integer Unix timestamp';
  }

  if (typeof data.registryIdentifier !== 'string' || !/^[0-9a-f]{64}$/.test(data.registryIdentifier)) {
    return '"registryIdentifier" must be a 64-character lowercase hexadecimal SHA-256';
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
