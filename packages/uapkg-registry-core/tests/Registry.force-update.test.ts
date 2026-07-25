import type { RegistryIdentifier, UnixTimestamp } from '@uapkg/common-schema';
import { ok } from '@uapkg/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Registry, RegistryLock } from '../src/index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Registry forced updates', () => {
  it('preserves the force decision after acquiring the registry lock', async () => {
    vi.spyOn(RegistryLock.prototype, 'acquire').mockResolvedValue(ok(true));
    vi.spyOn(RegistryLock.prototype, 'release').mockResolvedValue(ok(undefined));

    const registryId = 'registry-identifier' as RegistryIdentifier;
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
      exists: () => true,
      read: async () =>
        ok({
          lastRegistrySyncAt: Math.floor(Date.now() / 1000) as UnixTimestamp,
          registryIdentifier: registryId,
        }),
      write: async () => ok(undefined),
    };
    const internals = registry as unknown as {
      metadataReader: typeof metadata;
      updater: { update: typeof update };
    };
    internals.metadataReader = metadata;
    internals.updater = { update };

    await expect(registry.ensureUpToDate({ bypassFreshnessCheck: true })).resolves.toMatchObject({
      ok: true,
      value: 'Updated',
    });
    expect(update).toHaveBeenCalledOnce();
  });
});
