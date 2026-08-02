import os from 'node:os';
import path from 'node:path';

export type UAPKGBuildMode = 'development' | 'production';

/** Build mode selected by the generated CLI launcher. */
export const INTERNAL_BUILD_MODE_ENV = 'UAPKG_INTERNAL_BUILD_MODE';

/**
 * Global profile root selected by the generated CLI launcher.
 *
 * The environment variable name is retained for compatibility with existing
 * launchers even though the directory now contains all global CLI state.
 */
export const INTERNAL_PROFILE_HOME_ENV = 'UAPKG_INTERNAL_CONFIG_CACHE_HOME';

/** Resolve or normalize build mode, failing closed to production. */
export function resolveUapkgBuildMode(raw = process.env[INTERNAL_BUILD_MODE_ENV]): UAPKGBuildMode {
  return raw === 'development' ? 'development' : 'production';
}

/** Resolve the global profile root for an explicit build mode. */
export function resolveUapkgProfileRoot(mode: UAPKGBuildMode, homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, mode === 'development' ? '.uapkg-development' : '.uapkg');
}

/** Resolve the active global profile without creating it. */
export function resolveActiveUapkgProfileRoot(): string {
  const selectedHome = process.env[INTERNAL_PROFILE_HOME_ENV];
  if (selectedHome && selectedHome.trim().length > 0) {
    return path.resolve(selectedHome);
  }

  return resolveUapkgProfileRoot(resolveUapkgBuildMode());
}
