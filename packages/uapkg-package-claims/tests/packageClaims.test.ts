import { describe, expect, it } from 'vitest';
import { normalizePackageClaims } from '../src/index.js';

describe('normalizePackageClaims', () => {
  it('normalizes the mandatory core with defaults', () => {
    const result = normalizePackageClaims({ name: 'my-plugin', version: '1.2.3', kind: 'plugin' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      name: 'my-plugin',
      version: '1.2.3',
      private: false,
      dependencies: {},
      devDependencies: {},
      peerDependencies: {},
    });
  });

  it('accepts scoped names', () => {
    const result = normalizePackageClaims({ name: '@acme/tool', version: '0.1.0' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe('@acme/tool');
  });

  it('normalizes string shorthand and object dependencies identically', () => {
    const short = normalizePackageClaims({
      name: 'a',
      version: '1.0.0',
      dependencies: { foo: '^1.2.0' },
    });
    const long = normalizePackageClaims({
      name: 'a',
      version: '1.0.0',
      dependencies: { foo: { version: '^1.2.0' } },
    });
    expect(short.ok && long.ok).toBe(true);
    if (short.ok && long.ok) expect(short.value.dependencies).toEqual(long.value.dependencies);
  });

  it('normalizes explicit "default" registry to absence and preserves named aliases', () => {
    const result = normalizePackageClaims({
      name: 'a',
      version: '1.0.0',
      dependencies: {
        foo: { version: '^1.0.0', registry: 'default' },
        bar: { version: '^2.0.0', registry: 'internal' },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dependencies.foo).toEqual({ version: '^1.0.0' });
    expect(result.value.dependencies.bar).toEqual({ version: '^2.0.0', registry: 'internal' });
  });

  it('drops local install-path overrides from claims', () => {
    const result = normalizePackageClaims({
      name: 'a',
      version: '1.0.0',
      dependencies: { foo: { version: '^1.0.0', path: 'Plugins/Custom' } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.dependencies.foo).toEqual({ version: '^1.0.0' });
  });

  it('normalizes private: true', () => {
    const result = normalizePackageClaims({ name: 'a', version: '1.0.0', private: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.private).toBe(true);
  });

  it('tolerates unknown top-level members', () => {
    const result = normalizePackageClaims({
      name: 'a',
      version: '1.0.0',
      futureField: { anything: true },
    });
    expect(result.ok).toBe(true);
  });

  it('fails without name/version identity', () => {
    const result = normalizePackageClaims({ version: '1.0.0' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_MANIFEST_INVALID');
  });
});
