import { describe, expect, it } from 'vitest';
import { parseDevBuildOptions } from '../DevBuildOptions';

describe('parseDevBuildOptions', () => {
  it('defaults a normal build to production', () => {
    expect(parseDevBuildOptions('build', [])).toEqual({
      force: false,
      buildMode: 'production',
    });
  });

  it.each([
    ['--development', 'development'],
    ['--production', 'production'],
  ] as const)('selects %s mode explicitly', (flag, buildMode) => {
    expect(parseDevBuildOptions('build', [flag])).toEqual({
      force: false,
      buildMode,
    });
  });

  it('rejects conflicting build modes', () => {
    expect(() => parseDevBuildOptions('build', ['--development', '--production'])).toThrow(
      '--development and --production cannot be used together',
    );
  });

  it.each(['link', 'watch'] as const)('rejects mode overrides for %s', (command) => {
    expect(() => parseDevBuildOptions(command, ['--production'])).toThrow(
      `Build mode flags are not supported by ${command}; ${command} always uses a development build`,
    );
  });

  it('preserves the force option for link and unlink', () => {
    expect(parseDevBuildOptions('link', ['--force'])).toEqual({
      force: true,
      buildMode: undefined,
    });
    expect(parseDevBuildOptions('unlink', ['--force'])).toEqual({
      force: true,
      buildMode: undefined,
    });
  });

  it('rejects options that do not belong to the command', () => {
    expect(() => parseDevBuildOptions('build', ['--force'])).toThrow('Unsupported option for build: --force');
    expect(() => parseDevBuildOptions('watch', ['--force'])).toThrow('Unsupported option for watch: --force');
  });
});
