import { join } from 'node:path';
import { ok, type Result } from '@uapkg/diagnostics';
import { describe, expect, it, vi } from 'vitest';
import type { RegistryDescriptor } from '../src/contracts/RegistryCoreTypes.js';
import { RegistryUpdater } from '../src/registry/RegistryUpdater.js';

describe('RegistryUpdater initial clone', () => {
  it.each([
    {
      name: 'branch',
      ref: { type: 'branch', value: '  main  ' } as const,
      expectedCloneArgs: ['clone', '--single-branch', '--branch', 'main', 'https://github.com/uapkg/registry.git'],
    },
    {
      name: 'tag',
      ref: { type: 'tag', value: '  v1.2.3  ' } as const,
      expectedCloneArgs: ['clone', '--single-branch', '--branch', 'v1.2.3', 'https://github.com/uapkg/registry.git'],
    },
  ])('selects the configured $name during clone', async ({ ref, expectedCloneArgs }) => {
    const { cloneRepo, runGit, repoPath } = createCloneHarness(ref);

    await expect(cloneRepo(repoPath)).resolves.toMatchObject({ ok: true });
    expect(runGit).toHaveBeenCalledOnce();
    expect(runGit).toHaveBeenCalledWith([...expectedCloneArgs, repoPath]);
  });

  it('checks out a configured revision after a no-checkout clone', async () => {
    const { cloneRepo, runGit, repoPath } = createCloneHarness({
      type: 'rev',
      value: '  0123456789abcdef  ',
    });

    await expect(cloneRepo(repoPath)).resolves.toMatchObject({ ok: true });
    expect(runGit).toHaveBeenNthCalledWith(1, [
      'clone',
      '--no-checkout',
      'https://github.com/uapkg/registry.git',
      repoPath,
    ]);
    expect(runGit).toHaveBeenNthCalledWith(2, ['reset', '--hard', '0123456789abcdef'], repoPath);
  });

  it('does not attempt to check out a revision when clone fails', async () => {
    const { cloneRepo, runGit, repoPath } = createCloneHarness(
      { type: 'rev', value: '0123456789abcdef' },
      {
        ok: false,
        diagnostics: [
          {
            level: 'error',
            code: 'GIT_ERROR',
            message: 'clone failed',
            data: { command: 'git clone', stderr: 'failed', exitCode: 1 },
          },
        ],
      },
    );

    await expect(cloneRepo(repoPath)).resolves.toMatchObject({ ok: false });
    expect(runGit).toHaveBeenCalledOnce();
  });
});

function createCloneHarness(ref: RegistryDescriptor['ref'], result: Result<void> = ok(undefined)) {
  const updater = new RegistryUpdater(
    'registry-updater-test',
    {
      type: 'git',
      url: 'https://github.com/uapkg/registry.git',
      ref,
    },
    'git',
  );
  const runGit = vi.fn(async () => result);
  const internals = updater as unknown as {
    cloneRepo(repoPath: string): Promise<Result<void>>;
    runGit(args: string[], cwd?: string): Promise<Result<void>>;
  };
  internals.runGit = runGit;

  return {
    cloneRepo: internals.cloneRepo.bind(updater),
    runGit,
    repoPath: join(process.cwd(), `.registry-${ref.type}-test`),
  };
}
