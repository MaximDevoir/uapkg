import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INTERNAL_BUILD_MODE_ENV, INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createConfig } from '../src';

const temporaryDirectories: string[] = [];

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapkg-config-test-'));
  temporaryDirectories.push(root);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('createConfig', () => {
  it.each([
    [undefined, 'https://github.com/uapkg/registry'],
    ['production', 'https://github.com/uapkg/registry'],
    ['unexpected', 'https://github.com/uapkg/registry'],
    ['development', 'https://github.com/uapkg/registry-dev-tmp'],
  ] as const)('selects the %s build-mode default registry', (mode, expectedUrl) => {
    const root = createTempRoot();
    const profile = path.join(root, 'profile');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profile);
    if (mode === undefined) {
      vi.stubEnv(INTERNAL_BUILD_MODE_ENV, undefined);
    } else {
      vi.stubEnv(INTERNAL_BUILD_MODE_ENV, mode);
    }

    const config = createConfig({ cwd: root });

    expect(config.get('registry')).toBe('default');
    expect(config.get('registries.default.url')).toBe(expectedUrl);
    expect(config.get('registries.default.ref')).toEqual({ type: 'branch', value: 'main' });
    expect(fs.existsSync(profile)).toBe(false);
  });

  it('allows configured registry values to override the stamped build default', () => {
    const root = createTempRoot();
    const profile = path.join(root, 'profile');
    const project = path.join(root, 'Project');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'uapkg.json'),
      '{"name":"Project","type":"project","dependencies":[]}\n',
      'utf8',
    );
    writeGlobalConfig(profile, {
      registries: { default: { url: 'https://example.com/global' } },
    });
    writeLocalConfig(project, {
      registries: { default: { url: 'https://example.com/local' } },
    });
    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'development');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profile);

    const config = createConfig({ cwd: project });

    expect(config.get('registries.default.url')).toBe('https://example.com/local');
    expect(config.get('registries.default.ref')).toEqual({ type: 'branch', value: 'main' });
    expect(config.trace('registries.default.url')).toEqual([
      expect.objectContaining({
        source: 'default',
        value: 'https://github.com/uapkg/registry-dev-tmp',
      }),
      expect.objectContaining({ source: 'global', value: 'https://example.com/global' }),
      expect.objectContaining({ source: 'local', value: 'https://example.com/local' }),
    ]);
  });

  it('resolves merged values from default -> intermediary -> local', () => {
    const root = createTempRoot();
    const project = path.join(root, 'Project');
    const plugin = path.join(project, 'Plugins', 'MyPlugin');

    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'uapkg.json'),
      '{"name":"Project","type":"project","dependencies":[]}\n',
      'utf8',
    );

    fs.mkdirSync(path.join(project, '.uapkg'), { recursive: true });
    fs.writeFileSync(
      path.join(project, '.uapkg', 'config.json'),
      JSON.stringify({
        term: { quiet: true },
      }),
      'utf8',
    );

    fs.mkdirSync(path.join(plugin, '.uapkg'), { recursive: true });
    fs.writeFileSync(
      path.join(plugin, '.uapkg', 'config.json'),
      JSON.stringify({
        term: { verbose: true },
      }),
      'utf8',
    );

    const config = createConfig({ cwd: plugin });
    const resolved = config.getAll() as { term: { quiet: boolean; verbose: boolean } };

    expect(resolved.term.quiet).toBe(true);
    expect(resolved.term.verbose).toBe(true);
    expect(config.getWithOrigin('term.verbose')?.source).toBe('local');
    expect(config.trace('term.quiet').map((entry) => entry.source)).toContain('intermediary');
  });

  it('applies every layer in order without reading configurations above the nearest manifest root', () => {
    const root = createTempRoot();
    const profile = path.join(root, 'profile');
    const project = path.join(root, 'Project');
    const team = path.join(project, 'Team');
    const plugin = path.join(team, 'Plugin');

    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'uapkg.json'),
      '{"name":"Project","type":"project","dependencies":[]}\n',
      'utf8',
    );
    writeGlobalConfig(profile, { network: { retries: 3 } });
    writeLocalConfig(root, { network: { retries: 99 } });
    writeLocalConfig(project, { network: { retries: 4 } });
    writeLocalConfig(team, { network: { retries: 5 } });
    writeLocalConfig(plugin, { network: { retries: 6 } });
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profile);

    const config = createConfig({ cwd: plugin });

    expect(config.get('network.retries')).toBe(6);
    expect(config.trace('network.retries')).toEqual([
      expect.objectContaining({ source: 'default', value: 2 }),
      expect.objectContaining({ source: 'global', value: 3 }),
      expect.objectContaining({ source: 'intermediary', value: 4 }),
      expect.objectContaining({ source: 'intermediary', value: 5 }),
      expect.objectContaining({ source: 'local', value: 6 }),
    ]);
  });

  it('supports isolated instances with independent cwd', () => {
    const root = createTempRoot();
    const a = path.join(root, 'A');
    const b = path.join(root, 'B');

    fs.mkdirSync(path.join(a, '.uapkg'), { recursive: true });
    fs.mkdirSync(path.join(b, '.uapkg'), { recursive: true });
    fs.writeFileSync(
      path.join(a, '.uapkg', 'config.json'),
      '{"registry":"a","registries":{"a":{"url":"https://example.com/a","ref":{"type":"branch","value":"main"}}}}',
      'utf8',
    );
    fs.writeFileSync(
      path.join(b, '.uapkg', 'config.json'),
      '{"registry":"b","registries":{"b":{"url":"https://example.com/b","ref":{"type":"branch","value":"main"}}}}',
      'utf8',
    );

    const configA = createConfig({ cwd: a });
    const configB = createConfig({ cwd: b });

    expect(configA.get('registry')).toBe('a');
    expect(configB.get('registry')).toBe('b');
  });

  it('selects only the global profile while preserving the same project-local configuration', () => {
    const root = createTempRoot();
    const project = path.join(root, 'Project');
    const productionProfile = path.join(root, 'profiles', 'production');
    const developmentProfile = path.join(root, 'profiles', 'development');

    fs.mkdirSync(path.join(project, '.uapkg'), { recursive: true });
    fs.writeFileSync(
      path.join(project, 'uapkg.json'),
      '{"name":"Project","type":"project","dependencies":[]}\n',
      'utf8',
    );
    fs.writeFileSync(path.join(project, '.uapkg', 'config.json'), JSON.stringify({ term: { verbose: true } }), 'utf8');
    writeGlobalConfig(productionProfile, { term: { quiet: true } });
    writeGlobalConfig(developmentProfile, { term: { quiet: false } });

    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, productionProfile);
    const production = createConfig({ cwd: project });

    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, developmentProfile);
    const development = createConfig({ cwd: project });

    expect(production.get('term.quiet')).toBe(true);
    expect(development.get('term.quiet')).toBe(false);
    expect(production.get('term.verbose')).toBe(true);
    expect(development.get('term.verbose')).toBe(true);
    expect(production.getEditTarget({ scope: 'global' })).toBe(path.join(productionProfile, 'config.json'));
    expect(development.getEditTarget({ scope: 'global' })).toBe(path.join(developmentProfile, 'config.json'));
    expect(production.getEditTarget({ scope: 'local' })).toBe(path.join(project, '.uapkg', 'config.json'));
    expect(development.getEditTarget({ scope: 'local' })).toBe(path.join(project, '.uapkg', 'config.json'));
  });

  it('does not create a selected profile merely by reading configuration', () => {
    const root = createTempRoot();
    const profile = path.join(root, 'not-created');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profile);

    createConfig({ cwd: root });

    expect(fs.existsSync(profile)).toBe(false);
  });
});

function writeGlobalConfig(profile: string, config: Record<string, unknown>) {
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, 'config.json'), JSON.stringify(config), 'utf8');
}

function writeLocalConfig(directory: string, config: Record<string, unknown>) {
  const configDirectory = path.join(directory, '.uapkg');
  fs.mkdirSync(configDirectory, { recursive: true });
  fs.writeFileSync(path.join(configDirectory, 'config.json'), JSON.stringify(config), 'utf8');
}
