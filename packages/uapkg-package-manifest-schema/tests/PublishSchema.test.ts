import { describe, expect, it } from 'vite-plus/test';
import { PublishSchema } from '../src/index.ts';

describe('PublishSchema', () => {
  it('accepts stable GitHub Release publishing coordinates', () => {
    expect(
      PublishSchema.parse({
        registry: 'official',
        owner: 'acme',
        repository: 'acme/example',
        asset: 'package.tgz',
        manifestPath: 'packages/example/uapkg.json',
      }),
    ).toEqual({
      registry: 'official',
      owner: 'acme',
      repository: 'acme/example',
      asset: 'package.tgz',
      manifestPath: 'packages/example/uapkg.json',
    });
  });

  it('rejects a repository URL in place of an owner/repository coordinate', () => {
    expect(PublishSchema.safeParse({ repository: 'https://github.com/acme/example' }).success).toBe(false);
  });
});
