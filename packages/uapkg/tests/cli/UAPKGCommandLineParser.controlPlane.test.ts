import { describe, expect, it } from 'vite-plus/test';
import { UAPKGCommandLineParser } from '../../src/cli/parsing/UAPKGCommandLineParser.js';

const WHOAMI_FIELDS = ['username', 'user-id', 'registry', 'registry-id'] as const;
const WHOAMI_FORMS: ReadonlyArray<{
  readonly args: readonly string[];
  readonly field?: (typeof WHOAMI_FIELDS)[number];
  readonly registry?: string;
}> = [
  { args: [] },
  ...WHOAMI_FIELDS.map((field) => ({ args: [field], field })),
  { args: ['--registry', 'official'], registry: 'official' },
  ...WHOAMI_FIELDS.map((field) => ({
    args: [field, '--registry', 'official'],
    field,
    registry: 'official',
  })),
];

describe('UAPKG control-plane command parsing', () => {
  it('parses a registry-specific device reauthorization', async () => {
    const parsed = await new UAPKGCommandLineParser().parse([
      'node',
      'uapkg',
      'login',
      '--registry',
      'official',
      '--device-name',
      'Studio workstation',
      '--reauthorize',
      '--json',
    ]);

    expect(parsed).toMatchObject({
      command: 'login',
      registry: 'official',
      deviceName: 'Studio workstation',
      reauthorize: true,
      outputFormat: 'json',
    });
    expect(parsed).not.toHaveProperty('bearerToken');
    expect(parsed).not.toHaveProperty('apiUrl');
  });

  it('parses local-only logout and whoami', async () => {
    const parser = new UAPKGCommandLineParser();
    await expect(
      parser.parse(['node', 'uapkg', 'logout', '--registry', 'official', '--local-only']),
    ).resolves.toMatchObject({
      command: 'logout',
      registry: 'official',
      localOnly: true,
    });
    await expect(parser.parse(['node', 'uapkg', 'whoami', '--json'])).resolves.toMatchObject({
      command: 'whoami',
      outputFormat: 'json',
    });
  });

  it.each(WHOAMI_FORMS)('parses supported whoami form %# in text and JSON modes', async ({ args, field, registry }) => {
    for (const json of [false, true]) {
      await expect(
        new UAPKGCommandLineParser().parse(['node', 'uapkg', 'whoami', ...args, ...(json ? ['--json'] : [])]),
      ).resolves.toMatchObject({
        command: 'whoami',
        field,
        registry,
        outputFormat: json ? 'json' : 'text',
      });
    }
  });

  it.each([['unknown'], ['username', 'extra']])('rejects an invalid whoami field shape: %s', async (...args) => {
    await expect(new UAPKGCommandLineParser().parse(['node', 'uapkg', 'whoami', ...args])).rejects.toThrow();
  });

  it('parses the complete GitHub Release publish contract without accepting secret flags', async () => {
    const parsed = await new UAPKGCommandLineParser().parse([
      'node',
      'uapkg',
      'publish',
      '--registry',
      'official',
      '--owner',
      'acme',
      '--repository',
      'acme/example',
      '--tag',
      'v1.2.3',
      '--asset',
      'example.tgz',
      '--asset-path',
      'dist/example.tgz',
      '--auth',
      'gat',
      '--detach',
    ]);

    expect(parsed).toMatchObject({
      command: 'publish',
      registry: 'official',
      owner: 'acme',
      repository: 'acme/example',
      tag: 'v1.2.3',
      asset: 'example.tgz',
      assetPath: 'dist/example.tgz',
      auth: 'gat',
      detach: true,
    });
    expect(parsed).not.toHaveProperty('token');
    expect(parsed).not.toHaveProperty('otp');
  });

  it('parses request listing and watched status', async () => {
    const parser = new UAPKGCommandLineParser();
    await expect(parser.parse(['node', 'uapkg', 'requests', 'list', '--status', 'rejected'])).resolves.toMatchObject({
      command: 'requests',
      action: 'list',
      status: 'rejected',
    });
    await expect(parser.parse(['node', 'uapkg', 'requests', 'status', 'req_123', '--watch'])).resolves.toMatchObject({
      command: 'requests',
      action: 'status',
      requestId: 'req_123',
      watch: true,
    });
  });

  it.each([
    ['requests', 'status', '--watch'],
    ['requests', 'list', 'req_123'],
    ['requests', 'list', '--watch'],
    ['requests', 'status', 'req_123', '--status', 'rejected'],
    ['requests', 'status', 'req_123', '--registry', 'official'],
  ])('rejects invalid request command shape: %s', async (...args) => {
    await expect(new UAPKGCommandLineParser().parse(['node', 'uapkg', ...args])).rejects.toThrow();
  });
});
