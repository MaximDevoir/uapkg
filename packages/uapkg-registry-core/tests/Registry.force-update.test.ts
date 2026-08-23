import type { RegistryIdentifier, UnixTimestamp } from '@uapkg/common-schema';
import { ok } from '@uapkg/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Registry, RegistryLock } from '../src/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Registry forced updates', () => {
  it('preserves the force decision after acquiring the registry lock', async () => {
    vi.spyOn(RegistryLock.prototype, 'acquire').mockResolvedValue(ok(true));
    vi.spyOn(RegistryLock.prototype, 'release').mockResolvedValue(ok(undefined));

    const registryId = 'a'.repeat(64) as RegistryIdentifier;
    const registry = Registry.create(
      'official',
      {
        type: 'git',
        url: 'https://github.com/uapkg/registry.git',
        ref: { type: 'branch', value: 'main' },
      },
      registryId,
      'force-update-test',
      'git',
      3_600,
    );
    const update = vi.fn(async () => ok(undefined));
    const metadata = {
      write: async () => ok(undefined),
    };
    const inspect = vi.fn(async () =>
      ok({
        initialized: true,
        lastRegistrySyncAt: Math.floor(Date.now() / 1000) as UnixTimestamp,
      }),
    );
    const internals = registry as unknown as {
      metadataReader: typeof metadata;
      cacheValidator: { inspect: typeof inspect };
      updater: { update: typeof update };
    };
    internals.metadataReader = metadata;
    internals.cacheValidator = { inspect };
    internals.updater = { update };

    await expect(registry.ensureUpToDate({ bypassFreshnessCheck: true })).resolves.toMatchObject({
      ok: true,
      value: 'Updated',
    });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledOnce();
  });
});
