import { describe, expect, it } from 'vite-plus/test';
import { UAPKGCommandLineParser } from '../../src/cli/parsing/UAPKGCommandLineParser.js';

describe('UAPKG registry command parsing', () => {
  it.each(['auth', 'refresh'] as const)('parses registry %s with an optional alias and JSON output', async (action) => {
    await expect(
      new UAPKGCommandLineParser().parse(['node', 'uapkg', 'registry', action, 'private', '--json']),
    ).resolves.toMatchObject({
      command: 'registry',
      action,
      name: 'private',
      output: 'json',
      scope: undefined,
    });
  });

  it.each([
    ['auth', '--global'],
    ['auth', '--local'],
    ['refresh', '--global'],
    ['refresh', '--local'],
  ])('rejects registry %s with %s', async (action, scope) => {
    await expect(new UAPKGCommandLineParser().parse(['node', 'uapkg', 'registry', action, scope])).rejects.toThrow();
  });

  it.each([
    ['auth', 'private', 'https://example.test/registry'],
    ['refresh', 'private', 'extra'],
    ['auth', 'private', '--branch', 'main'],
    ['refresh', 'private', '--tag', 'v1'],
    ['refresh', 'private', '--rev', 'abc123'],
  ])('rejects non-alias registry operation arguments: %s', async (...args) => {
    await expect(new UAPKGCommandLineParser().parse(['node', 'uapkg', 'registry', ...args])).rejects.toThrow();
  });
});
