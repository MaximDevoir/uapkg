import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTERNAL_BUILD_MODE_ENV,
  INTERNAL_PROFILE_HOME_ENV,
  resolveActiveUapkgProfileRoot,
  resolveUapkgBuildMode,
  resolveUapkgProfileRoot,
} from '../src/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runtime profile', () => {
  it('preserves the internal launcher environment variable names', () => {
    expect(INTERNAL_BUILD_MODE_ENV).toBe('UAPKG_INTERNAL_BUILD_MODE');
    expect(INTERNAL_PROFILE_HOME_ENV).toBe('UAPKG_INTERNAL_CONFIG_CACHE_HOME');
  });

  it('resolves production and development roots from the same home directory', () => {
    const homeDirectory = path.join('D:', 'Users', 'example');

    expect(resolveUapkgProfileRoot('production', homeDirectory)).toBe(path.join(homeDirectory, '.uapkg'));
    expect(resolveUapkgProfileRoot('development', homeDirectory)).toBe(path.join(homeDirectory, '.uapkg-development'));
  });

  it('recognizes only the exact development build mode', () => {
    expect(resolveUapkgBuildMode('development')).toBe('development');

    for (const raw of ['', 'production', 'Development', 'development ', 'staging']) {
      expect(resolveUapkgBuildMode(raw)).toBe('production');
    }

    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'development');
    expect(resolveUapkgBuildMode()).toBe('development');

    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'unexpected');
    expect(resolveUapkgBuildMode()).toBe('production');
  });

  it('normalizes a nonblank launcher-selected profile root', () => {
    const selectedHome = path.join('.', 'profiles', '..', 'selected-profile');
    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'development');
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, selectedHome);

    expect(resolveActiveUapkgProfileRoot()).toBe(path.resolve(selectedHome));
  });

  it('derives the active root from the internal build mode when no profile root is selected', () => {
    vi.stubEnv(INTERNAL_PROFILE_HOME_ENV, '   ');
    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'development');
    expect(resolveActiveUapkgProfileRoot()).toBe(resolveUapkgProfileRoot('development'));

    vi.stubEnv(INTERNAL_BUILD_MODE_ENV, 'unexpected');
    expect(resolveActiveUapkgProfileRoot()).toBe(resolveUapkgProfileRoot('production'));
  });

  it('does not create directories while resolving a profile root', () => {
    const homeDirectory = path.join(os.tmpdir(), `uapkg-profile-resolution-${process.pid}-${Date.now()}`);
    const expectedRoot = path.join(homeDirectory, '.uapkg-development');

    expect(fs.existsSync(homeDirectory)).toBe(false);
    expect(resolveUapkgProfileRoot('development', homeDirectory)).toBe(expectedRoot);
    expect(fs.existsSync(homeDirectory)).toBe(false);
  });
});
