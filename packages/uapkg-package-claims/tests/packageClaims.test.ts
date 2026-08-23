import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';
import { normalizePackageClaims } from '../src/index.js';
import { ClaimedDependencySchema, PackageClaimsSchema } from '../src/schema/index.js';

describe('package claims schemas', () => {
  it('validates the canonical normalized claims representation', () => {
    const parsed = PackageClaimsSchema.safeParse({
      name: '@acme/tool',
      version: '1.2.3',
      private: false,
      dependencies: { engine: { version: '^5.4.0' } },
      devDependencies: {},
      peerDependencies: {},
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid package identities and dependency ranges', () => {
    expect(ClaimedDependencySchema.safeParse({ version: 'not-a-range' }).success).toBe(false);
    expect(
      PackageClaimsSchema.safeParse({
        name: '@foo_bar/pkg',
        version: '1.2.3',
        private: false,
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
      }).success,
    ).toBe(false);
  });

  it('rejects unknown top-level and nested dependency members', () => {
    expect(ClaimedDependencySchema.safeParse({ version: '^1.0.0', path: 'Plugins/Local' }).success).toBe(false);
    expect(
      PackageClaimsSchema.safeParse({
        name: 'tool',
        version: '1.2.3',
        private: false,
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
        futureClaim: true,
      }).success,
    ).toBe(false);
  });

  it('exposes package-name record keys to generated JSON Schema', () => {
    const schema = z.toJSONSchema(PackageClaimsSchema) as {
      properties?: {
        dependencies?: {
          propertyNames?: { pattern?: string; maxLength?: number };
        };
      };
    };
    expect(schema.properties?.dependencies?.propertyNames).toMatchObject({
      maxLength: 214,
      pattern: '^(?:@[a-z0-9][a-z0-9-]*\\/)?[a-z0-9][a-z0-9-]*$',
    });
  });
});

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
