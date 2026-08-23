import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { DevBuildStatusPrinter, resolveUapkgProfileRoots } from '../DevBuildStatusPrinter';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DevBuildStatusPrinter', () => {
  it('resolves the production and development profile roots from the same user home', () => {
    expect(resolveUapkgProfileRoots('D:/Users/example')).toEqual({
      production: path.join('D:/Users/example', '.uapkg'),
      development: path.join('D:/Users/example', '.uapkg-development'),
    });
  });

  it('prints both persistent config and cache profile roots', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      output.push(String(message));
    });
    const printer = new DevBuildStatusPrinter({
      production: 'D:\\Profiles\\.uapkg',
      development: 'D:\\Profiles\\.uapkg-development',
    });

    printer.printStatus({
      snapshotPath: 'D:\\workspace\\snapshot.json',
      snapshot: null,
      current: { kind: 'none' },
      isLinkedToWorkspace: false,
      binaryPath: null,
      globalBinDir: null,
      isGlobalBinOnPath: false,
      workspaceShimPath: null,
    });

    expect(output).toContain('Production Profile Root: D:\\Profiles\\.uapkg');
    expect(output).toContain('Development Profile Root: D:\\Profiles\\.uapkg-development');
  });

  it('routes manual external-link restoration through the local Vite+ toolchain', () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      output.push(String(message));
    });

    new DevBuildStatusPrinter().printExternalLinkNotRestored('D:\\other-uapkg');

    expect(output).toContain('[dev-build]   vp exec pnpm add --global .');
  });
});
