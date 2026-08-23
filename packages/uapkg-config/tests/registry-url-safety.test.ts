import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INTERNAL_PROFILE_HOME_ENV } from '@uapkg/common';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { createConfig } from '../src/index.js';
import { configSchema } from '../src/schema/configSchema.js';
import { ConfigCliValueParser } from '../src/schema/runtime/ConfigCliValueParser.js';
import { ConfigSchemaRuntime } from '../src/schema/runtime/ConfigSchemaRuntime.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

describe('registry URL safety', () => {
  it.each(['ssh://git@github.com/uapkg/registry.git', 'git@github.com:uapkg/registry.git', '../registries/team'])(
    'allows Git-owned credential and local-path forms: %s',
    (url) => {
      const config = createIsolatedConfig();

      const result = config.set('registries.team.url', url, { scope: 'global' });

      expect(result.ok).toBe(true);
    },
  );

  it.each([
    'https://token@github.com/uapkg/registry',
    'https://user:secret@github.com/uapkg/registry',
    'https://github.com/uapkg/registry?token=secret',
    'https://github.com/uapkg/registry#secret',
  ])('rejects unsafe HTTP(S) values without returning the submitted value: %s', (url) => {
    const config = createIsolatedConfig();

    const result = config.set('registries.team.url', url, { scope: 'global' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      const serialized = JSON.stringify(result.diagnostics);
      expect(serialized).not.toContain('secret');
      expect(serialized).not.toContain('token@');
    }
  });

  it('reports an unsafe manually edited profile without leaking its secret', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapkg-config-url-test-'));
    const profile = path.join(root, 'profile');
    temporaryDirectories.push(root);
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(
      path.join(profile, 'config.json'),
      JSON.stringify({
        registries: { private: { url: 'https://user:super-secret@example.test/registry' } },
      }),
      'utf8',
    );
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, profile);

    const config = createConfig({ cwd: root });
    const serialized = JSON.stringify(config.getDiagnostics());

    expect(config.getDiagnostics()).toEqual([expect.objectContaining({ code: 'CONFIG_INVALID_VALUE' })]);
    expect(serialized).not.toContain('super-secret');
  });

  it('does not echo an unsafe URL rejected by config set parsing', () => {
    const parser = new ConfigCliValueParser(new ConfigSchemaRuntime(configSchema));
    const result = parser.parse(
      'registries.private.url',
      'https://user:config-set-secret@example.test/registry?token=query-secret',
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('config-set-secret');
    expect(JSON.stringify(result)).not.toContain('query-secret');
  });
});

function createIsolatedConfig() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uapkg-config-url-test-'));
  temporaryDirectories.push(root);
  vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, path.join(root, 'profile'));
  return createConfig({ cwd: root });
}
