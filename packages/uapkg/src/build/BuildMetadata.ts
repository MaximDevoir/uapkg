import { createRequire } from 'node:module';

export type UAPKGBuildMode = 'development' | 'production';

export interface UAPKGBuildMetadata {
  readonly mode: UAPKGBuildMode;
  readonly packageVersion: string;
  readonly displayVersion: string;
}

interface PackageJson {
  readonly version: string;
}

const packageJson = createRequire(import.meta.url)('../../package.json') as PackageJson;

/**
 * Safe metadata for source execution. The package build replaces the emitted
 * JavaScript module with metadata for the requested build mode.
 */
export const UAPKG_BUILD_METADATA: UAPKGBuildMetadata = Object.freeze({
  mode: 'production',
  packageVersion: packageJson.version,
  displayVersion: packageJson.version,
});
