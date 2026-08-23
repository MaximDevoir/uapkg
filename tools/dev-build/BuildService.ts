import type { UAPKGBuildMode } from '@uapkg/common';
import type { ProcessRunner } from './ProcessRunner.ts';

export class BuildService {
  private readonly runner: ProcessRunner;
  private readonly workspaceRoot: string;

  constructor(runner: ProcessRunner, workspaceRoot: string) {
    this.runner = runner;
    this.workspaceRoot = workspaceRoot;
  }

  buildAll(mode: UAPKGBuildMode) {
    this.runner.run('vp', ['run', '--cache', '-w', 'pack:libraries'], this.workspaceRoot);
    this.runner.run('vp', ['run', '--cache', '-w', 'cli:build', '--', `--${mode}`], this.workspaceRoot);
  }

  buildCliWithDependencies() {
    this.runner.run('vp', ['run', '--cache', '-w', 'cli:build', '--', '--development'], this.workspaceRoot);
  }

  watchCliAndDependents() {
    this.runner.run('vp', ['run', 'build:link'], this.workspaceRoot);
    this.runner.run(
      'vp',
      ['run', '--no-cache', '--filter', '@uapkg/cli...', '--parallel', 'build:watch'],
      this.workspaceRoot,
    );
  }
}
