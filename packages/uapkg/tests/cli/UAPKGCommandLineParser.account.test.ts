import { describe, expect, it } from 'vitest';
import { UAPKGCommandLineParser } from '../../src/cli/parsing/UAPKGCommandLineParser.js';

describe('UAPKGCommandLineParser account command', () => {
  it('parses account status command with json output and bearer token', async () => {
    const parser = new UAPKGCommandLineParser();

    const parsed = await parser.parse([
      'node',
      'uapkg',
      'account',
      'status',
      '--json',
      '--bearer',
      'test-bearer',
      '--api-url',
      'https://api.uapkg.dev',
    ]);

    expect(parsed).toMatchObject({
      command: 'account',
      action: 'status',
      outputFormat: 'json',
      bearerToken: 'test-bearer',
      apiUrl: 'https://api.uapkg.dev',
    });
  });

  it('parses a resource-owner token grant with independent access and permissions', async () => {
    const parser = new UAPKGCommandLineParser();

    const parsed = await parser.parse([
      'node',
      'uapkg',
      'account',
      'token-create',
      '--bearer',
      'test-bearer',
      '--name',
      'ci-token',
      '--resource-owner',
      '55555555-5555-4555-8555-555555555555',
      '--expires-in-days',
      '14',
      '--registry-access',
      'selected',
      '--registry-id',
      '44444444-4444-4444-8444-444444444444',
      '--package-access',
      'selected',
      '--package-id',
      '33333333-3333-4333-8333-333333333333',
      '--permission',
      'registry.packages.moderate',
      '--permission',
      'package.publish',
      '--justification',
      'Publish approved releases from CI',
    ]);

    expect(parsed).toMatchObject({
      command: 'account',
      action: 'token-create',
      outputFormat: 'text',
      bearerToken: 'test-bearer',
      tokenName: 'ci-token',
      tokenResourceOwnerOrganizationId: '55555555-5555-4555-8555-555555555555',
      tokenRegistryAccessMode: 'selected',
      tokenRegistryIds: ['44444444-4444-4444-8444-444444444444'],
      tokenPackageAccessMode: 'selected',
      tokenPackageIds: ['33333333-3333-4333-8333-333333333333'],
      tokenPermissions: ['registry.packages.moderate', 'package.publish'],
      tokenExpiresInDays: 14,
      tokenJustification: 'Publish approved releases from CI',
    });
  });

  it('parses account token-revoke token-id option', async () => {
    const parser = new UAPKGCommandLineParser();

    const parsed = await parser.parse(['node', 'uapkg', 'account', 'token-revoke', '--token-id', 'tok_123']);

    expect(parsed).toMatchObject({
      command: 'account',
      action: 'token-revoke',
      tokenId: 'tok_123',
    });
  });
});
