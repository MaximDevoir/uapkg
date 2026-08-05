import { describe, expect, it } from 'vitest';
import { AssetHashSchema, isScopedPackageName, PackageNameSchema } from '../src/index.js';

describe('AssetHashSchema', () => {
  it('accepts exactly sha256 with 64 lowercase hex characters', () => {
    expect(AssetHashSchema.safeParse(`sha256:${'a'.repeat(64)}`).success).toBe(true);
  });

  it.each([
    ['other algorithm', `sha512:${'a'.repeat(128)}`],
    ['short digest', `sha256:${'a'.repeat(63)}`],
    ['long digest', `sha256:${'a'.repeat(65)}`],
    ['uppercase digest', `sha256:${'A'.repeat(64)}`],
    ['missing prefix', 'a'.repeat(64)],
    ['md5-like', `md5:${'a'.repeat(32)}`],
  ])('rejects %s', (_label, value) => {
    expect(AssetHashSchema.safeParse(value).success).toBe(false);
  });
});

describe('PackageNameSchema', () => {
  it.each(['my-package', 'a', 'pkg2', '@acme/tool', '@a1/b2-c3'])('accepts %s', (value) => {
    expect(PackageNameSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['uppercase', 'MyPackage'],
    ['leading hyphen', '-pkg'],
    ['bare scope', '@acme'],
    ['scope only slash', '@acme/'],
    ['double slash', '@acme/a/b'],
    ['missing scope name', '@/tool'],
    ['uppercase scope', '@Acme/tool'],
    ['spaces', 'my package'],
    ['too long', 'a'.repeat(215)],
  ])('rejects %s', (_label, value) => {
    expect(PackageNameSchema.safeParse(value).success).toBe(false);
  });

  it('classifies scoped names', () => {
    expect(isScopedPackageName('@acme/tool')).toBe(true);
    expect(isScopedPackageName('tool')).toBe(false);
  });
});
