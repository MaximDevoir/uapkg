import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { GlobalCommandShimService } from '../GlobalCommandShimService.ts';
import { ProcessRunner } from '../ProcessRunner.ts';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();

  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe('GlobalCommandShimService', () => {
  it('only reports a shim as workspace-owned when it targets this checkout', () => {
    const workspaceRoot = makeTemporaryDirectory('uapkg-workspace-');
    const globalBinDirectory = makeTemporaryDirectory('pnpm-bin-');
    const activeShimPath = path.join(globalBinDirectory, process.platform === 'win32' ? 'uapkg.cmd' : 'uapkg');
    const runner = new ProcessRunner();
    const runAndCapture = vi.spyOn(runner, 'runAndCapture').mockReturnValue({
      stdout: globalBinDirectory,
      stderr: '',
      status: 0,
    });
    const service = new GlobalCommandShimService(runner, workspaceRoot);

    fs.writeFileSync(activeShimPath, 'node "C:/pnpm/store/@uapkg/cli/dist/cli.js"', 'utf8');
    expect(service.resolveWorkspaceShimPath()).toBeNull();

    const workspaceEntry = path.join(workspaceRoot, 'packages', 'uapkg', 'dist', 'cli.js');
    fs.writeFileSync(activeShimPath, `node "${workspaceEntry}"`, 'utf8');
    expect(service.resolveWorkspaceShimPath()).toBe(activeShimPath);
    expect(runAndCapture).toHaveBeenCalledWith('vp', ['exec', 'pnpm', 'bin', '--global'], workspaceRoot, {
      ignoreFailure: true,
    });
  });
});

function makeTemporaryDirectory(prefix: string) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}
