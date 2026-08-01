import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBuildMetadata,
  DEVELOPMENT_BANNER_TEXT,
  INTERNAL_CONFIG_CACHE_HOME_ENV,
  parseBuildMode,
  renderCliLauncher,
  resolveCliBuildPaths,
  verifyBuiltCli,
  verifyProductionBuild,
  writeBuildArtifacts,
} from '../../build/CliBuild.js';

const temporaryDirectories: string[] = [];

function createTemporaryPackage() {
  const packageRoot = mkdtempSync(path.join(os.tmpdir(), 'uapkg-cli-build-'));
  temporaryDirectories.push(packageRoot);
  writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@uapkg/cli-build-test', private: true, type: 'module', version: '2.3.4' }),
    'utf8',
  );

  const paths = resolveCliBuildPaths(packageRoot);
  writeBuildArtifacts(paths, createBuildMetadata('production', '2.3.4'));
  writeFileSync(
    path.join(paths.distDirectory, 'cli-bootstrap.js'),
    `import { UAPKG_BUILD_METADATA } from './build/BuildMetadata.js';
if (process.argv.includes('--version')) {
  process.stdout.write(\`\${UAPKG_BUILD_METADATA.displayVersion}\\n\`);
} else if (process.argv.includes('--help')) {
  process.stdout.write('HELP OUTPUT\\n');
} else if (process.argv.includes('--config-cache-home')) {
  process.stdout.write(\`\${process.env.${INTERNAL_CONFIG_CACHE_HOME_ENV} ?? ''}\\n\`);
} else {
  process.stderr.write('COMMAND ERROR\\n');
  process.exitCode = 1;
}
`,
    'utf8',
  );
  return paths;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('CLI build mode', () => {
  it('defaults to production and accepts either explicit mode', () => {
    expect(parseBuildMode([])).toBe('production');
    expect(parseBuildMode(['--production'])).toBe('production');
    expect(parseBuildMode(['--development'])).toBe('development');
    expect(parseBuildMode(['--', '--development'])).toBe('development');
  });

  it('rejects conflicting, duplicate, and unknown flags', () => {
    expect(() => parseBuildMode(['--development', '--production'])).toThrow(
      '--development and --production cannot be used together',
    );
    expect(() => parseBuildMode(['--development', '--development'])).toThrow(
      'Each build mode flag may be provided only once',
    );
    expect(() => parseBuildMode(['--staging'])).toThrow('Unknown build option(s): --staging');
  });

  it('uses the package version verbatim in production and marks development versions', () => {
    expect(createBuildMetadata('production', '1.2.3')).toEqual({
      mode: 'production',
      packageVersion: '1.2.3',
      displayVersion: '1.2.3',
    });
    expect(createBuildMetadata('development', '1.2.3')).toEqual({
      mode: 'development',
      packageVersion: '1.2.3',
      displayVersion: '1.2.3-development-mode',
    });
  });

  it('renders the requested blue-background and white-text development banner', () => {
    const launcher = renderCliLauncher();

    expect(launcher).toContain('\\u001B[44m\\u001B[37mDEVELOPMENT BUILD\\u001B[0m');
    expect(launcher).toContain('process.stderr.write');
  });

  it('selects the stamped config and cache profile before importing the CLI', () => {
    const launcher = renderCliLauncher();

    expect(launcher.indexOf(`process.env.${INTERNAL_CONFIG_CACHE_HOME_ENV}`)).toBeLessThan(
      launcher.indexOf("await import('./cli-bootstrap.js')"),
    );
    expect(launcher).toContain("UAPKG_BUILD_METADATA.mode === 'development' ? '.uapkg-development' : '.uapkg'");
  });
});

describe('stamped CLI artifacts', () => {
  it('switches between development and production without cleaning dist', async () => {
    const paths = createTemporaryPackage();
    for (const staleName of ['cli.d.ts', 'cli.d.ts.map', 'cli.js.map']) {
      writeFileSync(path.join(paths.distDirectory, staleName), 'stale', 'utf8');
    }

    const development = createBuildMetadata('development', '2.3.4');
    writeBuildArtifacts(paths, development);
    await expect(verifyBuiltCli(paths, development)).resolves.toBeUndefined();
    expect(readFileSync(paths.metadataPath, 'utf8')).toContain('"mode": "development"');
    expect(readFileSync(paths.launcherPath, 'utf8')).toContain("await import('./cli-bootstrap.js')");

    const production = createBuildMetadata('production', '2.3.4');
    writeBuildArtifacts(paths, production);
    await expect(verifyBuiltCli(paths, production)).resolves.toBeUndefined();
    await expect(verifyProductionBuild(paths)).resolves.toBeUndefined();
    expect(readFileSync(paths.metadataPath, 'utf8')).toContain('"mode": "production"');
    for (const staleName of ['cli.d.ts', 'cli.d.ts.map', 'cli.js.map']) {
      expect(() => readFileSync(path.join(paths.distDirectory, staleName))).toThrow();
    }
  });

  it('writes the development banner before command errors while preserving help stdout', () => {
    const paths = createTemporaryPackage();
    writeBuildArtifacts(paths, createBuildMetadata('development', '2.3.4'));

    const errorResult = spawnSync(process.execPath, [paths.launcherPath, 'invalid'], {
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    expect(errorResult.status).toBe(1);
    expect(errorResult.stdout).toBe('');
    expect(errorResult.stderr).toBe(`${DEVELOPMENT_BANNER_TEXT}\nCOMMAND ERROR\n`);

    const helpResult = spawnSync(process.execPath, [paths.launcherPath, '--help'], {
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    expect(helpResult.status).toBe(0);
    expect(helpResult.stdout).toBe('HELP OUTPUT\n');
    expect(helpResult.stderr).toBe(`${DEVELOPMENT_BANNER_TEXT}\n`);
  });

  it.each([
    ['production', '.uapkg'],
    ['development', '.uapkg-development'],
  ] as const)('overrides inherited profile state for a %s build', (mode, profileDirectory) => {
    const paths = createTemporaryPackage();
    writeBuildArtifacts(paths, createBuildMetadata(mode, '2.3.4'));

    const result = spawnSync(process.execPath, [paths.launcherPath, '--config-cache-home'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        [INTERNAL_CONFIG_CACHE_HOME_ENV]: path.join(os.homedir(), 'wrong-profile'),
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${path.join(os.homedir(), profileDirectory)}\n`);
    expect(result.stderr).toBe(mode === 'development' ? `${DEVELOPMENT_BANNER_TEXT}\n` : '');
  });

  it('rejects a development artifact when production verification is required', async () => {
    const paths = createTemporaryPackage();
    writeBuildArtifacts(paths, createBuildMetadata('development', '2.3.4'));

    await expect(verifyProductionBuild(paths)).rejects.toThrow('Expected mode "production", received "development"');
  });
});

describe('build wiring', () => {
  it('keeps development and production Nx cache entries distinct and guards prepack', () => {
    const packageRoot = resolveCliBuildPaths().packageRoot;
    const project = JSON.parse(readFileSync(path.join(packageRoot, 'project.json'), 'utf8')) as {
      targets?: {
        build?: {
          cache?: boolean;
          outputs?: string[];
          defaultConfiguration?: string;
          configurations?: Record<string, { command?: string }>;
        };
      };
    };
    const packageJson = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(project.targets?.build).toMatchObject({
      cache: true,
      outputs: ['{projectRoot}/dist'],
      defaultConfiguration: 'production',
      configurations: {
        development: { command: 'pnpm run build -- --development' },
        production: { command: 'pnpm run build -- --production' },
      },
    });
    expect(packageJson.scripts?.prepack).toBe('pnpm run build -- --production && pnpm run verify:production-build');
  });
});
