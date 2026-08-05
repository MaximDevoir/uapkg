import { describe, expect, it } from 'vitest';
import {
  DependencySchema,
  LockfileSchema,
  ManifestSchema,
  normalizeDependencyDeclaration,
  toDependencyDeclaration,
} from '../src/index.js';

describe('dependency registry normalization', () => {
  it('normalizes string shorthand to an inherited (absent) registry', () => {
    const parsed = DependencySchema.parse('^1.2.0');
    expect(parsed).toEqual({ version: '^1.2.0' });
    expect('registry' in parsed).toBe(false);
  });

  it('normalizes explicit "default" to absence', () => {
    const parsed = DependencySchema.parse({ version: '^1.2.0', registry: 'default' });
    expect(parsed).toEqual({ version: '^1.2.0' });
  });

  it('preserves an explicit non-default registry alias', () => {
    const parsed = DependencySchema.parse({ version: '^1.2.0', registry: 'internal' });
    expect(parsed).toEqual({ version: '^1.2.0', registry: 'internal' });
  });

  it('round-trips to the short form for inherited registries', () => {
    expect(toDependencyDeclaration(normalizeDependencyDeclaration('^1.2.0' as never))).toBe('^1.2.0');
    expect(toDependencyDeclaration({ version: '^1.2.0', registry: 'default' } as never)).toBe('^1.2.0');
  });

  it('keeps long form when a named registry or path is present', () => {
    expect(toDependencyDeclaration({ version: '^1.2.0', registry: 'internal' } as never)).toEqual({
      version: '^1.2.0',
      registry: 'internal',
      path: undefined,
    });
  });
});

describe('LockfileSchema version dispatch', () => {
  const entry = {
    version: '1.0.0',
    registry: 'default',
    integrity: `sha256:${'a'.repeat(64)}`,
    gitTree: 'b'.repeat(40),
  };

  it('accepts the supported lockfile version', () => {
    expect(LockfileSchema.safeParse({ lockfileVersion: 1, packages: { foo: entry } }).success).toBe(true);
  });

  it.each([0, 2, 99])('fails closed for unsupported version %s', (version) => {
    expect(LockfileSchema.safeParse({ lockfileVersion: version, packages: {} }).success).toBe(false);
  });
});

describe('manifest unknown-member preservation', () => {
  it('preserves unknown top-level members through parsing', () => {
    const parsed = ManifestSchema.parse({
      name: 'my-plugin',
      version: '1.0.0',
      kind: 'plugin',
      futureField: { nested: true },
    });
    expect((parsed as Record<string, unknown>).futureField).toEqual({ nested: true });
  });
});
