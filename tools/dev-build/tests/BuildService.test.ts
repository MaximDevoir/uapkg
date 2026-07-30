import { afterEach, describe, expect, it, vi } from 'vitest';
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

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      ['nx', 'run-many', '-t', 'build', '--all', `--configuration=${mode}`],
      'D:/workspace',
    );
  });

  it('always builds the linked CLI with the development configuration', () => {
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
    const service = new BuildService(runner, 'D:/workspace');

    service.buildCliWithDependencies();

    expect(run).toHaveBeenCalledWith('pnpm', ['nx', 'run', 'uapkg:build:development'], 'D:/workspace');
  });

  it('performs an initial development link before watching for changes', () => {
    const runner = new ProcessRunner();
    const run = vi.spyOn(runner, 'run').mockImplementation(() => undefined);
    const service = new BuildService(runner, 'D:/workspace');

    service.watchCliAndDependents();

    expect(run).toHaveBeenCalledWith(
      'pnpm',
      [
        'nx',
        'watch',
        '--projects=uapkg',
        '--includeDependentProjects',
        '--initialRun',
        '--',
        'pnpm',
        'run',
        'build:link',
      ],
      'D:/workspace',
    );
  });
});
