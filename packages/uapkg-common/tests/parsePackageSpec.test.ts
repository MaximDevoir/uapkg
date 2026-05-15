import { describe, expect, it } from 'vitest';
import { formatPackageSpec, parsePackageSpec } from '../src/spec/parsePackageSpec';

describe('parsePackageSpec', () => {
  it('parses unscoped package names', () => {
    const result = parsePackageSpec('core-utils');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.org).toBeUndefined();
      expect(result.value.name).toBe('core-utils');
      expect(result.value.range).toBeUndefined();
    }
  });

  it('parses scoped package names with ranges', () => {
    const result = parsePackageSpec('@uapkg/core-utils@^1.0.0');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.org).toBe('uapkg');
      expect(result.value.name).toBe('core-utils');
      expect(result.value.range).toBe('^1.0.0');
    }
  });

  it('trims surrounding whitespace', () => {
    const result = parsePackageSpec('   @uapkg/core-utils@~2.0.1   ');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.org).toBe('uapkg');
      expect(result.value.name).toBe('core-utils');
      expect(result.value.range).toBe('~2.0.1');
    }
  });

  it('returns INVALID_PACKAGE_SPEC for empty input', () => {
    const result = parsePackageSpec('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('INVALID_PACKAGE_SPEC');
      expect(result.diagnostics[0]?.message).toContain('specifier is empty');
    }
  });

  it('returns INVALID_ORG_NAME for malformed org tokens', () => {
    const result = parsePackageSpec('@BadOrg/core-utils');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('INVALID_ORG_NAME');
    }
  });

  it('returns INVALID_VERSION_RANGE for malformed semver ranges', () => {
    const result = parsePackageSpec('core-utils@not-a-range');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics[0]?.code).toBe('INVALID_VERSION_RANGE');
    }
  });
});

describe('formatPackageSpec', () => {
  it('formats specs back to canonical string form', () => {
    const parsed = parsePackageSpec('@uapkg/core-utils@^3.2.1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(formatPackageSpec(parsed.value)).toBe('@uapkg/core-utils@^3.2.1');
    }
  });
});
