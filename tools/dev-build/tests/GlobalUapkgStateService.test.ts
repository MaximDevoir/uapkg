import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { GlobalUapkgStateService } from '../GlobalUapkgStateService';
import { ProcessRunner } from '../ProcessRunner';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe('GlobalUapkgStateService', () => {
  it('looks up the scoped @uapkg/cli package in the global list', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const { service } = makeService(
      workspaceRoot,
      JSON.stringify([
        {
          dependencies: {
            '@uapkg/cli': {
              version: '1.2.3',
            },
          },
        },
      ]),
    );

    expect(service.detectCurrentState()).toEqual({
      kind: 'published',
      version: '1.2.3',
    });
  });

  it('detects a pnpm 11 local global install from the install-group package.json', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const cliPackageDirectory = path.join(workspaceRoot, 'packages', 'uapkg');
    const installGroupDirectory = path.join(makeTemporaryDirectory('pnpm-home-'), 'global', 'v11', 'install-group');
    const dependencyPath = path.join(installGroupDirectory, 'node_modules', '@uapkg', 'cli');

    fs.mkdirSync(dependencyPath, { recursive: true });
    fs.writeFileSync(
      path.join(dependencyPath, 'package.json'),
      JSON.stringify({
        name: '@uapkg/cli',
        version: '1.2.3',
      }),
      'utf8',
    );
    fs.writeFileSync(
      path.join(installGroupDirectory, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@uapkg/cli': `link:${cliPackageDirectory}`,
        },
      }),
      'utf8',
    );

    const { service } = makeService(
      workspaceRoot,
      JSON.stringify([
        {
          dependencies: {
            '@uapkg/cli': {
              version: '1.2.3',
              path: dependencyPath,
            },
          },
        },
      ]),
    );

    const state = service.detectCurrentState();
    expect(state).toEqual({
      kind: 'link',
      path: cliPackageDirectory,
    });
    expect(service.isLinkedToWorkspace(state)).toBe(true);
  });

  it('keeps a normal global install classified as published', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const installGroupDirectory = path.join(makeTemporaryDirectory('pnpm-home-'), 'global', 'v11', 'install-group');
    const dependencyPath = path.join(installGroupDirectory, 'node_modules', '@uapkg', 'cli');

    fs.mkdirSync(dependencyPath, { recursive: true });
    fs.writeFileSync(
      path.join(installGroupDirectory, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@uapkg/cli': '1.2.3',
        },
      }),
      'utf8',
    );

    const { service } = makeService(
      workspaceRoot,
      JSON.stringify([
        {
          dependencies: {
            '@uapkg/cli': {
              version: '1.2.3',
              path: dependencyPath,
            },
          },
        },
      ]),
    );

    expect(service.detectCurrentState()).toEqual({
      kind: 'published',
      version: '1.2.3',
    });
  });

  it('registers the workspace CLI globally with the pnpm 11 add command', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const { service, run } = makeService(workspaceRoot, '[]');

    service.linkCurrentWorkspaceCli();

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      'vp',
      ['exec', 'pnpm', 'add', '--global', '.'],
      path.join(workspaceRoot, 'packages', 'uapkg'),
    );
  });

  it('removes and restores the scoped CLI package', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const { service, run, runAndCapture } = makeService(workspaceRoot, '[]');

    service.removeGlobalUapkg();
    service.installPublishedGlobal('1.2.3');

    expect(runAndCapture).toHaveBeenCalledWith(
      'vp',
      ['exec', 'pnpm', 'remove', '--global', '@uapkg/cli'],
      workspaceRoot,
      { ignoreFailure: true },
    );
    expect(run).toHaveBeenCalledWith('vp', ['exec', 'pnpm', 'add', '--global', '@uapkg/cli@1.2.3'], workspaceRoot);
  });

  it('treats malformed pnpm list JSON as no global CLI installation', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const { service, runAndCapture } = makeService(workspaceRoot, '{not-json');

    expect(service.detectCurrentState()).toEqual({ kind: 'none' });
    expect(runAndCapture).toHaveBeenCalledWith(
      'vp',
      ['exec', 'pnpm', 'list', '--global', '--depth', '0', '--json'],
      workspaceRoot,
    );
  });
});

function makeTemporaryDirectory(prefix: string) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}

function makeService(workspaceRoot: string, pnpmListJson: string) {
  const runner = new ProcessRunner();
  const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
  const runAndCapture = vi.spyOn(runner, 'runAndCapture').mockReturnValue({
    stdout: pnpmListJson,
    stderr: '',
    status: 0,
  });

  return {
    service: new GlobalUapkgStateService(runner, workspaceRoot),
    run,
    runAndCapture,
  };
}
