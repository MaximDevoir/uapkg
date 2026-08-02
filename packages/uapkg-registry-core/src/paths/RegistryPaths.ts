import { join } from 'node:path';
import { resolveActiveUapkgProfileRoot } from '@uapkg/common';

/**
 * Pure path helpers for registry cache layout.
 *
 * Layout:
 *   {profile-root}/registry/{shortId}/
 *     registry.json
 *     registry/          ← cloned registry repo
 *     packages/           ← reserved for future persistent package archives
 */

const REGISTRY_DIR = 'registry';

/** Root of all registry caches in the profile selected by the CLI launcher. */
export function getRegistryRoot(): string {
  return join(resolveActiveUapkgProfileRoot(), REGISTRY_DIR);
}

/** Cache root for a specific registry: `{profile-root}/registry/{shortId}` */
export function getRegistryCachePath(shortId: string): string {
  return join(getRegistryRoot(), shortId);
}

/** Path to the cloned registry repo. */
export function getRegistryRepoPath(shortId: string): string {
  return join(getRegistryCachePath(shortId), REGISTRY_DIR);
}

/** Path reserved for future persistent package archive caching. */
export function getRegistryPackagesPath(shortId: string): string {
  return join(getRegistryCachePath(shortId), 'packages');
}

/** Path to `registry.json` metadata file. */
export function getRegistryMetadataPath(shortId: string): string {
  return join(getRegistryCachePath(shortId), 'registry.json');
}

/** Path to the lock file used during updates. */
export function getRegistryLockPath(shortId: string): string {
  return join(getRegistryCachePath(shortId), '.lock');
}
