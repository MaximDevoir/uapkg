import { describe, expect, it } from 'vite-plus/test';
import { OrgNameSchema, PackageSpecSchema } from '../src/index';

describe('OrgNameSchema', () => {
  it('accepts valid org names', () => {
    expect(OrgNameSchema.safeParse('uapkg').success).toBe(true);
    expect(OrgNameSchema.safeParse('my-org').success).toBe(true);
    expect(OrgNameSchema.safeParse('my_org').success).toBe(true);
    expect(OrgNameSchema.safeParse('org2').success).toBe(true);
  });

  it('rejects invalid org names', () => {
    expect(OrgNameSchema.safeParse('MyOrg').success).toBe(false);
    expect(OrgNameSchema.safeParse('-myorg').success).toBe(false);
    expect(OrgNameSchema.safeParse('_myorg').success).toBe(false);
    expect(OrgNameSchema.safeParse('@myorg').success).toBe(false);
  });
});

describe('PackageSpecSchema', () => {
  it('accepts unscoped specs', () => {
    const result = PackageSpecSchema.safeParse({ name: 'core-utils' });
    expect(result.success).toBe(true);
  });

  it('accepts scoped specs with range', () => {
    const result = PackageSpecSchema.safeParse({
      org: 'uapkg',
      name: 'core-utils',
      range: '^1.2.3',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid org values', () => {
    const result = PackageSpecSchema.safeParse({
      org: 'BadOrg',
      name: 'core-utils',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown keys (strict object)', () => {
    const result = PackageSpecSchema.safeParse({
      name: 'core-utils',
      unsupported: true,
    });
    expect(result.success).toBe(false);
  });
});
