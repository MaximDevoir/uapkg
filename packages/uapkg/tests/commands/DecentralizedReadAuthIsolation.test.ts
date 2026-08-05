import { ok } from '@uapkg/diagnostics';
import type { InstallReport } from '@uapkg/installer';
import type { Lockfile, Manifest } from '@uapkg/package-manifest-schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionRoot } from '../../src/app/CompositionRoot.js';
import { AddCommand } from '../../src/commands/AddCommand.js';
import { InstallCommand } from '../../src/commands/InstallCommand.js';
import { UpdateCommand } from '../../src/commands/UpdateCommand.js';
import { AccountManager } from '../../src/control-plane/AccountManager.js';
import type { AuthMetadataStore } from '../../src/control-plane/AuthMetadataStore.js';
import { CredentialStore } from '../../src/control-plane/CredentialStore.js';

const manifest = {
  name: 'auth-isolation',
  version: '1.0.0',
  kind: 'project',
} as unknown as Manifest;

const lockfile = {
  lockfileVersion: 1,
  packages: {},
} as Lockfile;

const report: InstallReport = {
  plan: {
    actions: [],
    summary: {
      added: 0,
      updated: 0,
      removed: 0,
      unchanged: 0,
      totalBytes: 0,
    },
  },
  outcomes: [],
  installed: [],
  failed: [],
  skipped: [],
  incompleteClosure: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('decentralized read command authentication isolation', () => {
  it.each([
    'add',
    'install',
    'update',
  ] as const)('%s uses the shared Git/content path without control-plane or native keyring access', async (commandName) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const loadKeyring = vi.fn(async () => {
      throw new Error('The native keyring must remain unloaded for decentralized reads.');
    });
    const metadataFind = vi.fn(async () => undefined);
    const accountManager = new AccountManager(
      { find: metadataFind } as unknown as AuthMetadataStore,
      new CredentialStore(loadKeyring),
    );
    const packageManifest = {
      readManifest: vi.fn(async () => ok(manifest)),
      readLockfileOptional: vi.fn(async () => ok(null)),
      addDependency: vi.fn(async () => ok(undefined)),
      install: vi.fn(async () => ok(lockfile)),
    };
    const installer = {
      getStatusStream: vi.fn(() => emptyStatusStream()),
      execute: vi.fn(async () => ok(report)),
    };
    const root = {
      cwd: 'D:\\project',
      packageManifest,
      installer,
      accountManager,
      config: { get: vi.fn(() => 'official') },
      registryCore: {
        getOrCreateRegistry: vi.fn(() =>
          ok({
            resolvePackage: vi.fn(async () => ok({ version: '1.0.0' })),
          }),
        ),
      },
      json: { emit: vi.fn() },
      diagnostics: { reportAll: vi.fn() },
      postinstall: { run: vi.fn() },
    } as unknown as CompositionRoot;

    const command =
      commandName === 'add'
        ? new AddCommand(root, {
            spec: 'example',
            pin: false,
            dev: false,
            force: false,
            dryRun: true,
            outputFormat: 'json',
          })
        : commandName === 'install'
          ? new InstallCommand(root, {
              force: false,
              frozen: false,
              dryRun: true,
              outputFormat: 'json',
            })
          : new UpdateCommand(root, {
              specs: [],
              force: false,
              dryRun: true,
              outputFormat: 'json',
            });

    await expect(command.execute()).resolves.toBe(0);

    expect(packageManifest.install).toHaveBeenCalledWith({ frozen: false });
    if (commandName === 'add') {
      expect(packageManifest.addDependency).toHaveBeenCalledOnce();
    }
    expect(installer.execute).toHaveBeenCalledOnce();
    expect(metadataFind).not.toHaveBeenCalled();
    expect(loadKeyring).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

async function* emptyStatusStream(): AsyncGenerator<never> {
  yield* [];
}
