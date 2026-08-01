import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getRegistryCachePath,
  getRegistryLockPath,
  getRegistryMetadataPath,
  getRegistryPackagesPath,
  getRegistryRepoPath,
  getRegistryRoot,
} from '../src/index.js';

const INTERNAL_CONFIG_CACHE_HOME_ENV = 'UAPKG_INTERNAL_CONFIG_CACHE_HOME';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('registry cache profile paths', () => {
  it('uses the production profile when no launcher-selected home is present', () => {
    vi.stubEnv(INTERNAL_CONFIG_CACHE_HOME_ENV, '');

    expect(getRegistryRoot()).toBe(path.join(os.homedir(), '.uapkg', 'registry'));
  });

  it('uses the launcher-selected profile for every registry cache path without creating it', () => {
    const profile = path.join(os.tmpdir(), `uapkg-profile-path-${process.pid}-${Date.now()}`);
    vi.stubEnv(INTERNAL_CONFIG_CACHE_HOME_ENV, profile);

    expect(getRegistryRoot()).toBe(path.join(profile, 'registry'));
    expect(getRegistryCachePath('0123456789abcdef')).toBe(path.join(profile, 'registry', '0123456789abcdef'));
    expect(getRegistryRepoPath('0123456789abcdef')).toBe(
      path.join(profile, 'registry', '0123456789abcdef', 'registry'),
    );
    expect(getRegistryPackagesPath('0123456789abcdef')).toBe(
      path.join(profile, 'registry', '0123456789abcdef', 'packages'),
    );
    expect(getRegistryMetadataPath('0123456789abcdef')).toBe(
      path.join(profile, 'registry', '0123456789abcdef', 'registry.json'),
    );
    expect(getRegistryLockPath('0123456789abcdef')).toBe(path.join(profile, 'registry', '0123456789abcdef', '.lock'));
    expect(fs.existsSync(profile)).toBe(false);
  });
});
