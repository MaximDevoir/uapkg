import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { BuildService } from '../BuildService';
import { ProcessRunner } from '../ProcessRunner';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BuildService', () => {
  it.each(['development', 'production'] as const)('builds the monorepo with the %s configuration', (mode) => {
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
    const service = new BuildService(runner, 'D:/workspace');

    service.buildAll(mode);

    expect(run).toHaveBeenNthCalledWith(1, 'vp', ['run', '--cache', '-w', 'pack:libraries'], 'D:/workspace');
    expect(run).toHaveBeenNthCalledWith(
      2,
      'vp',
      ['run', '--cache', '-w', 'cli:build', '--', `--${mode}`],
      'D:/workspace',
    );
  });

  it('always builds the linked CLI with the development configuration', () => {
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
    const service = new BuildService(runner, 'D:/workspace');

    service.buildCliWithDependencies();

    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith(
      'vp',
      ['run', '--cache', '-w', 'cli:build', '--', '--development'],
      'D:/workspace',
    );
  });

  it('performs an initial development link before watching for changes', () => {
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
    const service = new BuildService(runner, 'D:/workspace');

    service.watchCliAndDependents();

    expect(run).toHaveBeenNthCalledWith(1, 'vp', ['run', 'build:link'], 'D:/workspace');
    expect(run).toHaveBeenNthCalledWith(
      2,
      'vp',
      ['run', '--no-cache', '--filter', '@uapkg/cli...', '--parallel', 'build:watch'],
      'D:/workspace',
    );
  });
});
