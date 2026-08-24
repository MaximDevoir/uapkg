import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { DiagnosticBag, type Result } from '@uapkg/diagnostics';
import type { RegistryDescriptor } from '../contracts/RegistryCoreTypes.ts';
import { getRegistryRepoPath } from '../paths/RegistryPaths.ts';
import { type GitCommandRunner, GitRunner } from './GitRunner.ts';

/**
 * Handles git clone and git fetch/pull for a single registry.
 */
export class RegistryUpdater {
  constructor(
    private readonly shortId: string,
    private readonly descriptor: RegistryDescriptor,
    gitBinary: string,
    private readonly runner: GitCommandRunner = new GitRunner(gitBinary, [descriptor.url]),
  ) {}

  /** Clone or fetch the registry repo as needed. */
  async update(): Promise<Result<void>> {
    const bag = new DiagnosticBag();
    const repoPath = getRegistryRepoPath(this.shortId);

    if (!existsSync(repoPath)) {
      const initResult = await this.cloneRepo(repoPath);
      if (!initResult.ok) {
        bag.mergeArray(initResult.diagnostics);
        return bag.toFailure();
      }
    } else {
      const fetchResult = await this.fetchRepo(repoPath);
      if (!fetchResult.ok) {
        bag.mergeArray(fetchResult.diagnostics);
        return bag.toFailure();
      }
    }

    return bag.toResult(undefined);
  }

  /** Probe remote access without cloning or mutating the local registry cache. */
  async probeAccess(interactive = false): Promise<Result<void>> {
    return this.runner.run(['ls-remote', this.descriptor.url, 'HEAD'], {
      interaction: interactive ? 'interactive' : 'non-interactive',
      timeoutMs: interactive ? 300_000 : 120_000,
    });
  }

  private async cloneRepo(repoPath: string): Promise<Result<void>> {
    const parentDir = repoPath.replace(/[/\\][^/\\]+$/, '');
    if (!existsSync(parentDir)) {
      await mkdir(parentDir, { recursive: true });
    }

    const refValue = this.descriptor.ref.value.trim();
    const args = ['clone'];
    if (this.descriptor.ref.type === 'branch' || this.descriptor.ref.type === 'tag') {
      args.push('--single-branch', '--branch', refValue);
    } else {
      args.push('--no-checkout');
    }
    args.push(this.descriptor.url, repoPath);

    const cloneResult = await this.runGit(args);
    if (!cloneResult.ok || this.descriptor.ref.type !== 'rev') {
      return cloneResult;
    }

    return this.runGit(['reset', '--hard', refValue], repoPath);
  }

  private async fetchRepo(repoPath: string): Promise<Result<void>> {
    const fetchResult = await this.runGit(['fetch', 'origin'], repoPath);
    if (!fetchResult.ok) return fetchResult;

    const ref = this.resolveRefSpec();
    return this.runGit(['reset', '--hard', ref], repoPath);
  }

  private resolveRefSpec(): string {
    switch (this.descriptor.ref.type) {
      case 'branch':
        return `origin/${this.descriptor.ref.value.trim()}`;
      case 'tag':
        return `tags/${this.descriptor.ref.value.trim()}`;
      case 'rev':
        return this.descriptor.ref.value.trim();
    }
  }

  private async runGit(args: string[], cwd?: string): Promise<Result<void>> {
    return this.runner.run(args, { cwd, interaction: 'non-interactive', timeoutMs: 120_000 });
  }
}
