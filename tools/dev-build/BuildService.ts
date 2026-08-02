import type { UAPKGBuildMode } from '@uapkg/common';
import type { ProcessRunner } from './ProcessRunner';

export class BuildService {
  constructor(
    private readonly runner: ProcessRunner,
    private readonly workspaceRoot: string,
  ) {}

  buildAll(mode: UAPKGBuildMode) {
    this.runner.run('pnpm', ['nx', 'run-many', '-t', 'build', '--all', `--configuration=${mode}`], this.workspaceRoot);
  }

  buildCliWithDependencies() {
    this.runner.run('pnpm', ['nx', 'run', 'uapkg:build:development'], this.workspaceRoot);
  }

  watchCliAndDependents() {
    this.runner.run(
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
      this.workspaceRoot,
    );
  }
}
