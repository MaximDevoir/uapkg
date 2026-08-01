import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Pure path helpers for registry cache layout.
 *
 * Layout:
 *   {config-cache-home}/registry/{shortId}/
 *     registry.json
 *     registry/          ← cloned registry repo
 *     packages/           ← reserved for future persistent package archives
 */

const UAPKG_DIR = '.uapkg';
const REGISTRY_DIR = 'registry';
const INTERNAL_CONFIG_CACHE_HOME_ENV = 'UAPKG_INTERNAL_CONFIG_CACHE_HOME';

/** Root of all registry caches in the profile selected by the CLI launcher. */
export function getRegistryRoot(): string {
  return join(getConfigCacheHome(), REGISTRY_DIR);
}

/** Cache root for a specific registry: `{config-cache-home}/registry/{shortId}` */
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

function getConfigCacheHome(): string {
  const selectedHome = process.env[INTERNAL_CONFIG_CACHE_HOME_ENV];
  if (selectedHome && selectedHome.trim().length > 0) {
    return resolve(selectedHome);
  }

  return join(homedir(), UAPKG_DIR);
}
