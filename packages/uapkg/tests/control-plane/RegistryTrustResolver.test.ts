import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalizeRegistryGitOrigin,
  fingerprintRegistryGitOrigin,
} from '../../src/control-plane/RegistryTrustResolver.js';

describe('registry control-plane source identity', () => {
  it.each([
    'https://github.com/UAPKG/Registry.git',
    'ssh://git@github.com/UAPKG/Registry.git',
    'git@github.com:UAPKG/Registry.git',
  ])('canonicalizes equivalent GitHub origin %s', (origin) => {
    expect(canonicalizeRegistryGitOrigin(origin)).toBe('https://github.com/uapkg/registry.git');
  });

  it('uses the server contract sha256:<64 lowercase hex> fingerprint', () => {
    const canonical = 'https://github.com/uapkg/registry.git';
    const expected = createHash('sha256').update(canonical).digest('hex');

    expect(fingerprintRegistryGitOrigin('git@github.com:UAPKG/Registry.git')).toBe(`sha256:${expected}`);
  });
});
