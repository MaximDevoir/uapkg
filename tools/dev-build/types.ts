export type DevBuildMode = 'build' | 'link' | 'watch' | 'unlink' | 'status' | 'clean' | 'cleanAll';

export type CliBuildMode = 'development' | 'production';

export interface DevBuildOptions {
  force: boolean;
  buildMode?: CliBuildMode;
}

export type CurrentGlobalUapkgState =
  | { kind: 'none' }
  | { kind: 'published'; version: string }
  | { kind: 'link'; path: string };

export type SavedGlobalUapkgState =
  | { kind: 'none' }
  | { kind: 'published'; version: string }
  | { kind: 'external-link'; path: string; restorePolicy: 'do-not-restore' };

export interface GlobalUapkgSnapshot {
  createdAt: string;
  workspaceRoot: string;
  packageName: '@uapkg/cli' | 'uapkg';
  previous: SavedGlobalUapkgState;
}
