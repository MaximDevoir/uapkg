import fs from 'node:fs';
import path from 'node:path';
import { PathUtils } from './PathUtils';
import type { ProcessRunner } from './ProcessRunner';
import type { CurrentGlobalUapkgState } from './types';

const CLI_PACKAGE_NAME = '@uapkg/cli';

interface PnpmGlobalDependencyRecord {
  version?: string;
  path?: string;
}

interface PnpmGlobalListRoot {
  dependencies?: Record<string, PnpmGlobalDependencyRecord>;
}

interface PnpmGlobalInstallManifest {
  dependencies?: Record<string, string>;
}

export class GlobalUapkgStateService {
  private readonly pathUtils: PathUtils;

  constructor(
    private readonly runner: ProcessRunner,
    private readonly workspaceRoot: string,
  ) {
    this.pathUtils = new PathUtils();
  }

  getCliPackageDirectory() {
    return path.join(this.workspaceRoot, 'packages', 'uapkg');
  }

  isLinkedToWorkspace(state: CurrentGlobalUapkgState) {
    if (state.kind !== 'link') {
      return false;
    }

    return this.pathUtils.isSamePath(state.path, this.getCliPackageDirectory());
  }

  detectCurrentState(): CurrentGlobalUapkgState {
    const { stdout } = this.runner.runAndCapture(
      'pnpm',
      ['list', '--global', '--depth', '0', '--json'],
      this.workspaceRoot,
    );

    const parsed = this.tryParseList(stdout);
    const dependency = this.findGlobalCliDependency(parsed);
    if (!dependency) {
      return { kind: 'none' };
    }

    const version = dependency.version ?? '';
    const linkPath = this.findLinkPath(dependency, version);
    if (linkPath) {
      return {
        kind: 'link',
        path: linkPath,
      };
    }

    return {
      kind: 'published',
      version,
    };
  }

  removeGlobalUapkg(ignoreFailure = true) {
    this.runner.runAndCapture('pnpm', ['remove', '--global', CLI_PACKAGE_NAME], this.workspaceRoot, { ignoreFailure });
  }

  installPublishedGlobal(version: string) {
    this.runner.run('pnpm', ['add', '--global', `${CLI_PACKAGE_NAME}@${version}`], this.workspaceRoot);
  }

  linkCurrentWorkspaceCli() {
    this.runner.run('pnpm', ['add', '--global', '.'], this.getCliPackageDirectory());
  }

  private tryParseList(rawJson: string): PnpmGlobalListRoot[] {
    try {
      const parsed = JSON.parse(rawJson) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed as PnpmGlobalListRoot[];
    } catch {
      return [];
    }
  }

  private findGlobalCliDependency(roots: PnpmGlobalListRoot[]) {
    for (const root of roots) {
      const dependency = root.dependencies?.[CLI_PACKAGE_NAME];
      if (dependency) {
        return dependency;
      }
    }

    return null;
  }

  private findLinkPath(dependency: PnpmGlobalDependencyRecord, version: string) {
    if (version.startsWith('link:')) {
      const fromVersion = version.slice('link:'.length);
      return this.pickLinkPath(dependency.path, fromVersion);
    }

    return this.findIsolatedGlobalLinkPath(dependency.path);
  }

  private findIsolatedGlobalLinkPath(dependencyPath: string | undefined) {
    if (!dependencyPath) {
      return null;
    }

    let directory = path.dirname(dependencyPath);
    for (let depth = 0; depth < 4; depth += 1) {
      const manifestPath = path.join(directory, 'package.json');
      const specifier = this.readGlobalInstallSpecifier(manifestPath);
      if (specifier !== null) {
        if (!specifier.startsWith('link:')) {
          return null;
        }

        const linkPath = specifier.slice('link:'.length);
        return path.resolve(directory, linkPath);
      }

      const parent = path.dirname(directory);
      if (parent === directory) {
        break;
      }

      directory = parent;
    }

    return null;
  }

  private readGlobalInstallSpecifier(manifestPath: string) {
    if (!fs.existsSync(manifestPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw) as PnpmGlobalInstallManifest;
      return manifest.dependencies?.[CLI_PACKAGE_NAME] ?? null;
    } catch {
      return null;
    }
  }

  private pickLinkPath(dependencyPath: string | undefined, fromVersion: string) {
    if (fromVersion.length > 0) {
      return fromVersion;
    }

    if (dependencyPath) {
      return dependencyPath;
    }

    return this.getCliPackageDirectory();
  }
}
