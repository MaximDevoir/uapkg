import { fail, ok } from '@uapkg/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import type { CompositionRoot } from '../../src/app/CompositionRoot.ts';
import { RegistryCommand } from '../../src/commands/RegistryCommand.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RegistryCommand auth', () => {
  it('uses the selected alias and succeeds without prompting when Git access already works', async () => {
    const probeAccess = vi.fn(async () => ok(undefined));
    const { root } = createRoot({ probeAccess });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const command = new RegistryCommand(
      root,
      { action: 'auth', output: 'text' },
      { isInteractiveTerminal: () => true },
    );

    await expect(command.execute()).resolves.toBe(0);
    expect(probeAccess).toHaveBeenCalledOnce();
    expect(probeAccess).toHaveBeenCalledWith({ interactive: false });
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('Registry "default" is accessible'));
  });

  it('retries through interactive system Git only when a terminal is available', async () => {
    const probeAccess = vi.fn().mockResolvedValueOnce(gitFailure()).mockResolvedValueOnce(ok(undefined));
    const { root } = createRoot({ probeAccess });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const command = new RegistryCommand(
      root,
      { action: 'auth', name: 'private', output: 'text' },
      { isInteractiveTerminal: () => true },
    );

    await expect(command.execute()).resolves.toBe(0);
    expect(probeAccess).toHaveBeenNthCalledWith(1, { interactive: false });
    expect(probeAccess).toHaveBeenNthCalledWith(2, { interactive: true });
  });

  it('fails headlessly with CI-safe setup guidance and a JSON envelope', async () => {
    const probeAccess = vi.fn(async () => gitFailure());
    const { root, diagnostics, json } = createRoot({ probeAccess });
    const command = new RegistryCommand(
      root,
      { action: 'auth', name: 'private', output: 'json' },
      { isInteractiveTerminal: () => false },
    );

    await expect(command.execute()).resolves.toBe(1);
    expect(probeAccess).toHaveBeenCalledOnce();
    expect(diagnostics.reportAll).not.toHaveBeenCalled();
    expect(json.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        command: 'registry auth',
        diagnostics: [expect.objectContaining({ hint: expect.stringContaining('GIT_ASKPASS') })],
      }),
    );
  });
});

describe('RegistryCommand refresh', () => {
  it('forces a refresh for an explicit alias and reports JSON', async () => {
    const ensureUpToDate = vi.fn(async () => ok('Updated' as const));
    const { root, registryCore, json } = createRoot({ ensureUpToDate });
    const command = new RegistryCommand(root, {
      action: 'refresh',
      name: 'private',
      output: 'json',
    });

    await expect(command.execute()).resolves.toBe(0);
    expect(registryCore.getOrCreateRegistry).toHaveBeenCalledWith('private');
    expect(ensureUpToDate).toHaveBeenCalledWith({
      bypassFreshnessCheck: true,
      logicalRegistryName: 'private',
    });
    expect(json.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ok',
        command: 'registry refresh',
        data: { action: 'refresh', name: 'private', result: 'Updated' },
      }),
    );
  });

  it('returns failure when offline fallback reports a failed forced refresh', async () => {
    const ensureUpToDate = vi.fn(async () =>
      ok('Failed' as const, [
        {
          level: 'warning' as const,
          code: 'REGISTRY_UNREACHABLE',
          message: 'Registry unavailable.',
          data: {
            registryName: 'default',
            url: 'https://example.test/registry',
            cause: 'offline',
            initialized: true,
          },
        },
      ]),
    );
    const { root, diagnostics } = createRoot({ ensureUpToDate });
    const command = new RegistryCommand(root, { action: 'refresh', output: 'text' });

    await expect(command.execute()).resolves.toBe(1);
    expect(diagnostics.reportAll).toHaveBeenCalledWith([expect.objectContaining({ code: 'REGISTRY_UNREACHABLE' })]);
  });
});

function createRoot(registryOverrides: Record<string, unknown>) {
  const registry = {
    probeAccess: vi.fn(async () => ok(undefined)),
    ensureUpToDate: vi.fn(async () => ok('Updated' as const)),
    ...registryOverrides,
  };
  const registryCore = {
    getOrCreateRegistry: vi.fn(() => ok(registry)),
  };
  const diagnostics = { reportAll: vi.fn() };
  const json = { emit: vi.fn() };
  const root = {
    cwd: 'D:\\workspace',
    config: {
      get: vi.fn((path: string) => (path === 'registry' ? 'default' : null)),
      getDiagnostics: vi.fn(() => []),
    },
    registryCore,
    diagnostics,
    json,
  } as unknown as CompositionRoot;
  return { root, registry, registryCore, diagnostics, json };
}

function gitFailure() {
  return fail([
    {
      level: 'error' as const,
      code: 'GIT_ERROR',
      message: 'Git command failed.',
      data: { command: 'git ls-remote <registry-url> HEAD', stderr: 'not found', exitCode: 128 },
    },
  ]);
}
