import type { RegistryIdentifier } from '@uapkg/common-schema';
import { createCacheIdentifierCollisionDiagnostic, fail, ok, type Result } from '@uapkg/diagnostics';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Registry, RegistryLock } from '../src/index.js';
import type { RegistryCacheState } from '../src/registry/RegistryCacheValidator.js';

const registryId = 'a'.repeat(64) as RegistryIdentifier;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Registry cache validation boundaries', () => {
  it('rejects an invalid cache before TTL evaluation or Git mutation', async () => {
    const collision = fail([createCacheIdentifierCollisionDiagnostic('/cache', registryId, 'b'.repeat(64))]);
    const { registry, inspect, update } = createHarness([collision]);
    const acquire = vi.spyOn(RegistryLock.prototype, 'acquire');

    const result = await registry.ensureUpToDate();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('CACHE_IDENTIFIER_COLLISION');
    expect(inspect).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('revalidates under the update lock and stops before Git mutation', async () => {
    vi.spyOn(RegistryLock.prototype, 'acquire').mockResolvedValue(ok(true));
    vi.spyOn(RegistryLock.prototype, 'release').mockResolvedValue(ok(undefined));
    const collision = fail([createCacheIdentifierCollisionDiagnostic('/cache', registryId, 'b'.repeat(64))]);
    const { registry, inspect, update } = createHarness([ok({ initialized: false }), collision]);

    const result = await registry.ensureUpToDate();

    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('CACHE_IDENTIFIER_COLLISION');
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
  });
});

function createHarness(inspections: Result<RegistryCacheState>[]) {
  const registry = Registry.create(
    'official',
    {
      type: 'git',
      url: 'https://github.com/uapkg/registry.git',
      ref: { type: 'branch', value: 'main' },
    },
    registryId,
    'cache-validation-test',
    'git',
    3_600,
  );
  const inspect = vi.fn<() => Promise<Result<RegistryCacheState>>>();
  for (const inspection of inspections) {
    inspect.mockResolvedValueOnce(inspection);
  }
  const update = vi.fn(async () => ok(undefined));
  const internals = registry as unknown as {
    cacheValidator: { inspect: typeof inspect };
    updater: { update: typeof update };
  };
  internals.cacheValidator = { inspect };
  internals.updater = { update };

  return { registry, inspect, update };
}
