import { dirname, join } from 'node:path';
import { resolveActiveUapkgProfileRoot } from '@uapkg/common';

const AUTH_METADATA_FILE_NAME = 'auth.json';
const AUTH_LOCKS_DIRECTORY_NAME = 'auth-locks';

export interface AuthStoragePaths {
  readonly metadataFile: string;
  readonly locksDirectory: string;
}

/**
 * Resolves the CLI-owned files used for persistent authentication state.
 * An explicit metadata path keeps the historical custom-store behavior by
 * placing its locks alongside that file.
 */
export function resolveAuthStoragePaths(metadataFile?: string): AuthStoragePaths {
  const resolvedMetadataFile = metadataFile ?? join(resolveActiveUapkgProfileRoot(), AUTH_METADATA_FILE_NAME);
  return {
    metadataFile: resolvedMetadataFile,
    locksDirectory: join(dirname(resolvedMetadataFile), AUTH_LOCKS_DIRECTORY_NAME),
  };
}
