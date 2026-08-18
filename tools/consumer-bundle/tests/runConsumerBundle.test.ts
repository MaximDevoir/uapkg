import { describe, expect, it } from 'vitest';
import { parseConsumerBundleOptions } from '../runConsumerBundle';

describe('consumer bundle CLI options', () => {
  it('accepts package-manager separators and repeatable roots', () => {
    expect(
      parseConsumerBundleOptions([
        '--',
        '--consumer',
        '../registry-infra/package.json',
        '--output',
        '../registry-infra/.uapkg-deps',
        '--root',
        '@uapkg/common-schema',
        '--root',
        '@uapkg/registry-schema',
        '--requested-ref',
        'feature/schema',
        '--expected-commit',
        'a'.repeat(40),
        '--ci',
      ]),
    ).toEqual({
      consumer: '../registry-infra/package.json',
      output: '../registry-infra/.uapkg-deps',
      requestedRef: 'feature/schema',
      roots: ['@uapkg/common-schema', '@uapkg/registry-schema'],
      expectedCommit: 'a'.repeat(40),
      ci: true,
      help: false,
    });
  });

  it('rejects unknown and valueless options', () => {
    expect(() => parseConsumerBundleOptions(['--unknown'])).toThrow('Unknown option');
    expect(() => parseConsumerBundleOptions(['--consumer', '--ci'])).toThrow('--consumer requires a value');
  });
});
