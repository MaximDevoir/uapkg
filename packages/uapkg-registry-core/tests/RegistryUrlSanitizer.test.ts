import { describe, expect, it } from 'vite-plus/test';
import { redactRegistryUrlSecrets, sanitizeRegistryUrlForDisplay } from '../src/registry/RegistryUrlSanitizer.ts';

describe('registry URL diagnostic safety', () => {
  it('fails closed for a malformed HTTP coordinate', () => {
    const url = 'https://alice:password@[invalid?token=query-secret#fragment-secret';
    const output = redactRegistryUrlSecrets(
      `Git rejected ${url}; alice password token=query-secret fragment-secret`,
      url,
    );

    expect(sanitizeRegistryUrlForDisplay(url)).toBe('<registry-url>');
    expect(output).not.toContain('alice');
    expect(output).not.toContain('password');
    expect(output).not.toContain('query-secret');
    expect(output).not.toContain('fragment-secret');
  });

  it('preserves SSH usernames because authentication remains key-based', () => {
    expect(sanitizeRegistryUrlForDisplay('ssh://git@example.test/acme/registry.git')).toBe(
      'ssh://git@example.test/acme/registry.git',
    );
    expect(sanitizeRegistryUrlForDisplay('git@example.test:acme/registry.git')).toBe(
      'git@example.test:acme/registry.git',
    );
  });
});
