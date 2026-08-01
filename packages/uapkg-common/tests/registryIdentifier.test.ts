import { describe, expect, it } from 'vitest';
import { computeRegistryIdentifier, computeRegistryIdentifierShort, normalizeUrl } from '../src/index.js';

describe('normalizeUrl', () => {
  it.each([
    'https://github.com/uapkg/registry',
    'https://GITHUB.com/UAPKG/Registry.git/',
    'https://user:secret@github.com:443/UAPKG/Registry.git',
    'ssh://git@github.com:22/UAPKG/Registry.git/',
    'git@github.com:UAPKG/Registry.git',
  ])('normalizes the GitHub coordinate %s to one repository identity', (url) => {
    expect(normalizeUrl(url)).toBe('https://github.com/uapkg/registry');
  });

  it('removes credentials and default ports while retaining case-sensitive generic paths', () => {
    expect(normalizeUrl('ssh://git:secret@Git.Example.com:22/Team/Registry.git/')).toBe(
      'ssh://git.example.com/Team/Registry',
    );
    expect(normalizeUrl('https://user:secret@Git.Example.com:443/Team/Registry.git/')).toBe(
      'https://git.example.com/Team/Registry',
    );
  });

  it.each([
    ['http://Git.Example.com:80/Team/Registry.git/', 'http://git.example.com/Team/Registry'],
    ['git://Git.Example.com:9418/Team/Registry.git/', 'git://git.example.com/Team/Registry'],
    ['file:///C:/Team/Registry.git/', 'file:///C:/Team/Registry'],
  ])('treats the scheme URL %s as a URL rather than SCP-like syntax', (url, expected) => {
    expect(normalizeUrl(url)).toBe(expected);
  });

  it('preserves generic repository path case and non-default ports', () => {
    expect(normalizeUrl('https://Git.Example.com:8443/Team/Registry.git/')).toBe(
      'https://git.example.com:8443/Team/Registry',
    );
    expect(normalizeUrl('https://GitHub.com:8443/UAPKG/Registry.git/')).toBe('https://github.com:8443/uapkg/registry');
    expect(normalizeUrl('C:\\Team\\Registry.git\\')).toBe('C:\\Team\\Registry');
  });

  it('does not collapse malformed GitHub subpaths into a valid repository coordinate', () => {
    expect(normalizeUrl('https://github.com/UAPKG/Registry/tree/Main')).toBe(
      'https://github.com/uapkg/registry/tree/Main',
    );
    expect(normalizeUrl('https://github.com/UAPKG/Registry/tree/Main')).not.toBe(
      normalizeUrl('https://github.com/UAPKG/Registry'),
    );
  });
});

describe('registry identifiers', () => {
  const main = {
    url: 'https://github.com/uapkg/registry',
    ref: { type: 'branch', value: 'main' },
  };

  it('hashes equivalent GitHub coordinates to the same identifier', () => {
    const expected = computeRegistryIdentifier(main);

    expect(
      computeRegistryIdentifier({
        url: 'git@GITHUB.com:UAPKG/Registry.git/',
        ref: { type: 'branch', value: '  main  ' },
      }),
    ).toBe(expected);
    expect(computeRegistryIdentifierShort(main)).toBe(expected.slice(0, 16));
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes ref type and case-preserved ref value in the identity', () => {
    expect(
      computeRegistryIdentifier({
        ...main,
        ref: { type: 'tag', value: 'main' },
      }),
    ).not.toBe(computeRegistryIdentifier(main));
    expect(
      computeRegistryIdentifier({
        ...main,
        ref: { type: 'branch', value: 'Main' },
      }),
    ).not.toBe(computeRegistryIdentifier(main));
  });
});
