import os from 'node:os';
import path from 'node:path';

/**
 * Set by the generated CLI launcher before bootstrapping the application.
 *
 * This is intentionally not a user-facing configuration override. It isolates
 * only global configuration and registry cache state for development builds.
 */
export const INTERNAL_CONFIG_CACHE_HOME_ENV = 'UAPKG_INTERNAL_CONFIG_CACHE_HOME';

export function resolveConfigCacheHome(): string {
  const selectedHome = process.env[INTERNAL_CONFIG_CACHE_HOME_ENV];
  if (selectedHome && selectedHome.trim().length > 0) {
    return path.resolve(selectedHome);
  }

  return path.join(os.homedir(), '.uapkg');
}
