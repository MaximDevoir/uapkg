import { describe, expect, it } from 'vitest';
import { RegistryURLSchema } from '../src/index.js';

describe('RegistryURLSchema', () => {
  it.each([
    'https://github.com/uapkg/registry',
    'ssh://git@github.com/uapkg/registry.git',
    'git@github.com:uapkg/registry.git',
    '../registries/team',
    'C:\\registries\\team',
  ])('accepts Git coordinate %s', (value) => {
    expect(RegistryURLSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    'https://token@github.com/uapkg/registry',
    'https://user:secret@github.com/uapkg/registry',
    'https://github.com/uapkg/registry?token=secret',
    'https://github.com/uapkg/registry#secret',
  ])('rejects unsafe HTTP(S) coordinate without echoing it: %s', (value) => {
    const result = RegistryURLSchema.safeParse(value);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).not.toContain('secret');
      expect(JSON.stringify(result.error.issues)).not.toContain('token@');
    }
  });
});
