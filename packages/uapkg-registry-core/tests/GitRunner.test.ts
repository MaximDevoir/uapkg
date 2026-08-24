import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vite-plus/test';
import { type GitProcessSpawner, GitRunner } from '../src/registry/GitRunner.ts';

describe('GitRunner', () => {
  it.each([
    {
      interaction: 'non-interactive' as const,
      prompt: '0',
      gcm: '0',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
    {
      interaction: 'interactive' as const,
      prompt: '1',
      gcm: '1',
      stdio: ['inherit', 'ignore', 'inherit'],
      windowsHide: false,
    },
  ])('runs Git in $interaction mode', async ({ interaction, prompt, gcm, stdio, windowsHide }) => {
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child) as unknown as GitProcessSpawner;
    const runner = new GitRunner('git-custom', [], spawnProcess);

    const resultPromise = runner.run(['ls-remote', 'ssh://git@example.test/acme/registry', 'HEAD'], {
      interaction,
    });
    child.emit('close', 0, null);

    await expect(resultPromise).resolves.toMatchObject({ ok: true });
    const options = spawnProcessMockOptions(spawnProcess);
    expect(options.env).toMatchObject({ GIT_TERMINAL_PROMPT: prompt, GCM_INTERACTIVE: gcm });
    expect(options.stdio).toEqual(stdio);
    expect(options.windowsHide).toBe(windowsHide);
  });

  it('redacts HTTP credentials, query data, and fragments from failures', async () => {
    const registryUrl = 'https://alice:s3cr%40t@example.test/acme/registry.git?token=query-secret#frag-secret';
    const child = fakeChild();
    const spawnProcess = vi.fn(() => child) as unknown as GitProcessSpawner;
    const runner = new GitRunner('git', [registryUrl], spawnProcess);

    const resultPromise = runner.run(['ls-remote', registryUrl, 'HEAD']);
    child.stderr?.emit('data', `fatal: ${registryUrl}; alice s3cr@t token=query-secret frag-secret`);
    child.emit('close', 128, null);
    const result = await resultPromise;

    expect(result.ok).toBe(false);
    expect(spawnProcess).toHaveBeenCalledWith('git', ['ls-remote', registryUrl, 'HEAD'], expect.any(Object));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('s3cr');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('frag-secret');
    expect(serialized).toContain('https://example.test/acme/registry.git');
  });
});

function fakeChild(): ChildProcess {
  const child = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stderr = new PassThrough();
  child.stdout = new PassThrough();
  child.kill = vi.fn(() => true);
  return child as unknown as ChildProcess;
}

function spawnProcessMockOptions(spawnProcess: GitProcessSpawner): SpawnOptions {
  return (spawnProcess as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as SpawnOptions;
}
