import { describe, expect, it } from 'vitest';
import { ControlPlaneError } from '../../src/control-plane/ControlPlaneTypes.js';
import {
  PUBLISH_SUBMISSION_ERROR_CATALOG,
  type PublishRequestErrorContext,
  publishRequestDiagnosticForError,
} from '../../src/control-plane/PublishRequestErrorMapper.js';

const context: PublishRequestErrorContext = {
  packageName: 'example',
  packageVersion: '1.2.3',
  registryAlias: 'official',
  registryName: 'Official',
  registryIssuer: 'https://account.uapkg.dev/oauth',
  credentialKind: 'login',
  repository: 'acme/example',
};

describe('publishRequestDiagnosticForError', () => {
  it('explains how to select an owner for a first unscoped publication without exposing wire names', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError(
        'UNSCOPED_PACKAGE_OWNER_REQUIRED',
        'Initial publication requires ownerOrganizationName.',
        400,
        { packageName: 'example' },
      ),
      context,
    );

    expect(diagnostic).toMatchObject({
      code: 'PUBLISH_REQUEST_FAILED',
      message: '"example" needs an owner organization before it can be published for the first time.',
      hint: expect.stringContaining('--owner <organization>'),
      data: {
        serverCode: 'UNSCOPED_PACKAGE_OWNER_REQUIRED',
        status: 400,
        facts: expect.arrayContaining([
          { kind: 'package', value: 'example' },
          { kind: 'version', value: '1.2.3' },
          { kind: 'registry', value: 'Official (official)' },
        ]),
        resources: expect.arrayContaining([
          { kind: 'command', command: 'uapkg publish --owner <organization>', label: expect.any(String) },
          { kind: 'command', command: 'uapkg publish --help', label: expect.any(String) },
        ]),
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('ownerOrganizationName');
  });

  it('states both sides of a granular-token owner mismatch and sorts server-provided owners', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('GAT_OWNER_ORGANIZATION_MISMATCH', 'unsafe server prose', 403, {
        packageName: 'example',
        requestedOwnerOrganizationName: 'widgets',
        tokenOwnerOrganizationNames: ['zeta', 'acme', 'acme'],
        resourceOwnerOrganizationId: 'private-organization-id',
      }),
      { ...context, credentialKind: 'gat', requestedOwner: 'widgets' },
    );

    expect(diagnostic.message).toBe(
      'The selected token was created for "acme" or "zeta", but this publication asks to use "widgets".',
    );
    expect(diagnostic.data.facts).toEqual(
      expect.arrayContaining([
        { kind: 'requested-owner', value: 'widgets' },
        { kind: 'token-owner', value: 'acme' },
        { kind: 'token-owner', value: 'zeta' },
      ]),
    );
    const renderedData = JSON.stringify(diagnostic);
    expect(renderedData).not.toContain('unsafe server prose');
    expect(renderedData).not.toContain('private-organization-id');
  });

  it('extracts only bounded token access modes and friendly capability labels', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('INITIAL_PUBLICATION_PACKAGE_ACCESS_ALL_REQUIRED', 'unsafe', 403, {
        packageName: 'example',
        actualPackageAccessMode: 'selected',
        requiredPackageAccessMode: 'all',
        missingCapabilities: ['package.publish'],
        packageAccess: { mode: 'selected', resourceIds: ['private-package-id'] },
        target: { registryId: 'private-registry-id' },
      }),
      { ...context, credentialKind: 'gat' },
    );

    expect(diagnostic.data.facts).toEqual(
      expect.arrayContaining([
        { kind: 'actual-access-mode', value: 'Selected packages' },
        { kind: 'required-access-mode', value: 'All packages' },
        { kind: 'missing-capability', value: 'Publish packages' },
      ]),
    );
    const renderedData = JSON.stringify(diagnostic);
    expect(renderedData).not.toContain('package.publish');
    expect(renderedData).not.toContain('private-package-id');
    expect(renderedData).not.toContain('private-registry-id');
  });

  it('does not invent a missing token capability from legacy access-mode details', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('INITIAL_PUBLICATION_PACKAGE_ACCESS_ALL_REQUIRED', 'unsafe', 403, {
        packageAccess: { mode: 'selected', resourceIds: ['private-package-id'] },
      }),
      { ...context, credentialKind: 'gat' },
    );

    expect(diagnostic.data.facts).toEqual(
      expect.arrayContaining([
        { kind: 'actual-access-mode', value: 'Selected packages' },
        { kind: 'required-access-mode', value: 'All packages' },
      ]),
    );
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'missing-capability' }));
  });

  it('shows a friendly missing capability for an insufficient CLI login scope', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('OAUTH_SCOPE_INSUFFICIENT', 'unsafe', 403, {
        requestedScopes: ['publishing.request.create'],
        requiredScopes: ['publishing.request.create'],
        missingScopes: ['publishing.request.create'],
      }),
      context,
    );

    expect(diagnostic.data.facts).toContainEqual({
      kind: 'missing-capability',
      value: 'Submit publishing requests',
    });
    expect(diagnostic.data.resources).toContainEqual(
      expect.objectContaining({ kind: 'command', label: 'Reauthorize this registry login' }),
    );
    expect(JSON.stringify(diagnostic)).not.toContain('publishing.request.create');
  });

  it('names requested and allowed UAPKG owners and provides an exact option fragment for one allowed namespace', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        packageName: 'example',
        requestedOwnerOrganizationName: 'widgets',
        allowedOwnerOrganizationNames: ['ts1'],
      }),
      { ...context, requestedOwner: 'widgets' },
    );

    expect(diagnostic.message).toContain('"widgets"');
    expect(diagnostic.data.facts).toContainEqual({ kind: 'requested-owner', value: 'widgets' });
    expect(diagnostic.data.facts).toContainEqual({ kind: 'allowed-owner', value: 'ts1' });
    expect(diagnostic.hint).toContain('Retry with `--owner ts1`');
    expect(diagnostic.data.resources).not.toContainEqual(
      expect.objectContaining({ kind: 'command', command: expect.stringContaining('--owner') }),
    );
  });

  it('does not recommend --owner when the package scope determines ownership', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        requestedOwnerOrganizationName: 'widgets',
        allowedOwnerOrganizationNames: ['ts1'],
      }),
      { ...context, packageName: '@widgets/example', requestedOwner: 'widgets' },
    );

    expect(diagnostic.hint).toContain('`@owner` scope determines ownership');
    expect(diagnostic.hint).toContain('allowed UAPKG organization scopes');
    expect(diagnostic.hint).not.toContain('--owner');
  });

  it('uses generic guidance when the server has no allowed owner suggestions', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        requestedOwnerOrganizationName: 'widgets',
        allowedOwnerOrganizationNames: [],
      }),
      { ...context, requestedOwner: 'widgets' },
    );

    expect(diagnostic.hint).toContain('Choose a UAPKG organization namespace where you can publish');
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'allowed-owner' }));
  });

  it('sorts multiple allowed UAPKG owners without claiming one exact retry', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        requestedOwnerOrganizationName: 'widgets',
        allowedOwnerOrganizationNames: ['zeta', 'acme', 'acme'],
      }),
      { ...context, requestedOwner: 'widgets' },
    );

    expect(diagnostic.data.facts.filter((value) => value.kind === 'allowed-owner')).toEqual([
      { kind: 'allowed-owner', value: 'acme' },
      { kind: 'allowed-owner', value: 'zeta' },
    ]);
    expect(diagnostic.hint).toContain('Choose one of the allowed UAPKG organization namespaces');
    expect(diagnostic.data.resources).not.toContainEqual(
      expect.objectContaining({ kind: 'command', command: expect.stringContaining('--owner') }),
    );
  });

  it('rejects malformed or oversized allowed-owner diagnostics as one untrusted detail object', () => {
    const oversizedOwner = `owner-${'x'.repeat(101)}`;
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        requestedOwnerOrganizationName: 'server-requested-owner',
        allowedOwnerOrganizationNames: ['ts1', oversizedOwner],
      }),
      { ...context, requestedOwner: 'safe-local-owner' },
    );

    expect(diagnostic.data.facts).toContainEqual({ kind: 'requested-owner', value: 'safe-local-owner' });
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'allowed-owner' }));
    expect(JSON.stringify(diagnostic)).not.toContain('server-requested-owner');
    expect(JSON.stringify(diagnostic)).not.toContain(oversizedOwner);
  });

  it('rejects a server owner list above the public 20-name bound instead of presenting it as complete', () => {
    const allowedOwnerOrganizationNames = Array.from({ length: 21 }, (_, index) => `team-${index}`);
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNER_NOT_AUTHORIZED', 'unsafe', 403, {
        requestedOwnerOrganizationName: 'server-requested-owner',
        allowedOwnerOrganizationNames,
      }),
      { ...context, requestedOwner: 'safe-local-owner' },
    );

    expect(diagnostic.data.facts).toContainEqual({ kind: 'requested-owner', value: 'safe-local-owner' });
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'allowed-owner' }));
    expect(diagnostic.hint).toContain('Choose a UAPKG organization namespace where you can publish');
  });

  it.each([
    ['login', 'Your account', undefined],
    ['gat', 'granular access token', 'Access token settings'],
    ['oidc', 'GitHub Actions workflow', 'Trusted publishers'],
  ] as const)('tailors a generic authority denial to a %s credential', (credentialKind, expectedMessage, expectedResourceLabel) => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('REGISTRY_WRITE_DENIED_REBAC', 'unsafe', 403),
      { ...context, credentialKind },
    );

    expect(diagnostic.message).toContain(expectedMessage);
    if (expectedResourceLabel) {
      expect(diagnostic.data.resources).toContainEqual(
        expect.objectContaining({ kind: 'url', label: expectedResourceLabel }),
      );
    } else {
      expect(diagnostic.data.resources).not.toContainEqual(expect.objectContaining({ kind: 'url' }));
    }
  });

  it('describes only active trusted-publisher policy fields for OIDC authority denial', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('TRUSTED_PUBLISHER_NOT_AUTHORIZED', 'unsafe', 403),
      { ...context, credentialKind: 'oidc' },
    );

    expect(diagnostic.hint).toContain('repository, workflow, and optional GitHub Environment');
    expect(diagnostic.hint).not.toMatch(/\bevent\b|\bref\b/u);
  });

  it('shows submitted and trusted repositories for an OIDC mismatch', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('OIDC_SOURCE_REPOSITORY_MISMATCH', 'unsafe', 403, {
        packageName: 'example',
        submittedRepository: 'acme/example',
        trustedRepository: 'acme/canonical',
      }),
      { ...context, credentialKind: 'oidc' },
    );

    expect(diagnostic.message).toContain('"acme/example"');
    expect(diagnostic.message).toContain('"acme/canonical"');
    expect(diagnostic.data.facts).toEqual(
      expect.arrayContaining([
        { kind: 'requested-repository', value: 'acme/example' },
        { kind: 'trusted-repository', value: 'acme/canonical' },
      ]),
    );
    expect(diagnostic.data.resources).toContainEqual({
      kind: 'url',
      url: 'https://account.uapkg.dev/trusted-publishers',
      label: 'Trusted publishers',
    });
  });

  it('asks for a new trusted-publishing session when its trusted repository is unavailable', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('OIDC_SOURCE_REPOSITORY_MISMATCH', 'unsafe', 403, {
        packageName: 'example',
        submittedRepository: 'acme/example',
      }),
      { ...context, credentialKind: 'oidc' },
    );

    expect(diagnostic.message).toContain('could not determine the trusted repository');
    expect(diagnostic.hint).toContain('Start a new trusted-publishing workflow');
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'trusted-repository' }));
  });

  it('shows only caller-readable duplicate request IDs', () => {
    const duplicate = publishRequestDiagnosticForError(
      new ControlPlaneError('DUPLICATE_ACTIVE_REQUEST', 'unsafe', 409, {
        packageName: 'example',
        packageVersion: '1.2.3',
        activeRequestId: 'request-readable',
      }),
      context,
    );
    const ownershipConflict = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_OWNERSHIP_PENDING_CONFLICT', 'unsafe', 409, {
        packageName: 'example',
        packageVersion: '1.2.3',
        activeRequestId: 'request-not-readable',
      }),
      context,
    );

    expect(duplicate.data.facts).toContainEqual({ kind: 'request-id', value: 'request-readable' });
    expect(duplicate.data.resources).toContainEqual({
      kind: 'command',
      command: 'uapkg requests status request-readable',
      label: 'Inspect the related request',
    });
    expect(JSON.stringify(ownershipConflict)).not.toContain('request-not-readable');
  });

  it('links a caller-readable request that is blocking further package changes', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('PACKAGE_HALTED', 'unsafe', 409, {
        packageName: 'example',
        blockingRequestId: 'request-readable',
      }),
      context,
    );

    expect(diagnostic.data.facts).toContainEqual({ kind: 'request-id', value: 'request-readable' });
    expect(diagnostic.data.resources).toContainEqual({
      kind: 'command',
      command: 'uapkg requests status request-readable',
      label: 'Inspect the related request',
    });
  });

  it('uses validated rate-limit timing without exposing other policy details', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('RATE_LIMIT_EXCEEDED', 'policy registryRequest.account', 429, {
        retryAfterSeconds: 120,
        policyName: 'private-policy-name',
        resetAt: 9_999_999,
      }),
      context,
    );

    expect(diagnostic.hint).toContain('2 minutes');
    expect(diagnostic.data.facts).toContainEqual({ kind: 'retry-after', value: '2 minutes' });
    expect(JSON.stringify(diagnostic)).not.toContain('private-policy-name');
  });

  it('rejects malformed and control-character details instead of partially rendering them', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('GAT_OWNER_ORGANIZATION_MISMATCH', 'unsafe\nserver\tmessage', 403, {
        requestedOwnerOrganizationName: 'widgets\u001b[31m',
        tokenOwnerOrganizationNames: ['acme', 'bad\u202eowner'],
        arbitrary: { bearerToken: 'secret-token' },
      }),
      { ...context, credentialKind: 'gat', requestedOwner: 'safe-local-owner' },
    );

    expect(diagnostic.data.facts).toContainEqual({ kind: 'requested-owner', value: 'safe-local-owner' });
    const renderedData = JSON.stringify(diagnostic);
    expect(renderedData).not.toContain('bad');
    expect(renderedData).not.toContain('secret-token');
    expect(renderedData).not.toContain('unsafe\\nserver');
  });

  it('rejects oversized and incorrectly typed details without leaking partial values', () => {
    const oversizedOwner = `owner-${'x'.repeat(101)}`;
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('GAT_OWNER_ORGANIZATION_MISMATCH', 'unsafe', 403, {
        requestedOwnerOrganizationName: oversizedOwner,
        tokenOwnerOrganizationNames: 'acme',
        arbitrary: { accessToken: 'secret-token' },
      }),
      { ...context, credentialKind: 'gat' },
    );

    const renderedData = JSON.stringify(diagnostic);
    expect(renderedData).not.toContain(oversizedOwner);
    expect(renderedData).not.toContain('secret-token');
    expect(diagnostic.data.facts).not.toContainEqual(expect.objectContaining({ kind: 'token-owner' }));
  });

  it('gives every cataloged code a problem, remediation, and publish help resource', () => {
    for (const serverCode of Object.keys(PUBLISH_SUBMISSION_ERROR_CATALOG)) {
      const diagnostic = publishRequestDiagnosticForError(
        new ControlPlaneError(serverCode, 'server prose must not be used', 400, { arbitrary: 'private-value' }),
        context,
      );
      expect(diagnostic.message, serverCode).toBeTruthy();
      expect(diagnostic.hint, serverCode).toBeTruthy();
      expect(diagnostic.data.resources, serverCode).toContainEqual(
        expect.objectContaining({ kind: 'command', command: 'uapkg publish --help' }),
      );
      expect(JSON.stringify(diagnostic), serverCode).not.toContain('private-value');
      expect(JSON.stringify(diagnostic), serverCode).not.toContain('server prose');
    }
  });

  it.each([
    ['INVALID_OWNER_ORGANIZATION_NAME', '--owner <organization>'],
    ['GITHUB_REPOSITORY_INVALID', '--repository owner/repository'],
    ['RELEASE_TAG_INVALID', '--tag <tag>'],
    ['RELEASE_ASSET_NAME_INVALID', '--asset <file-name>'],
    ['INVALID_PACKAGE_NAME', 'uapkg.json'],
  ])('gives %s a fix for the field the user can change', (serverCode, expectedFix) => {
    const diagnostic = publishRequestDiagnosticForError(new ControlPlaneError(serverCode, 'unsafe', 400), context);

    expect(diagnostic.hint).toContain(expectedFix);
  });

  it('maps an incomplete registry link to reconnect guidance and settings', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('REGISTRY_LINK_NOT_READY', 'unsafe', 409),
      context,
    );

    expect(diagnostic).toMatchObject({
      message: 'The selected registry repository connection is incomplete.',
      hint: expect.stringContaining('Finish reconnecting'),
      data: { serverCode: 'REGISTRY_LINK_NOT_READY', status: 409 },
    });
    expect(diagnostic.data.resources).toContainEqual({
      kind: 'url',
      url: 'https://account.uapkg.dev/settings/registries',
      label: 'Registry settings',
    });
  });

  it('uses non-leaking fallbacks for unknown server codes and network errors', () => {
    const unknown = publishRequestDiagnosticForError(
      new ControlPlaneError('FUTURE_SERVER_FAILURE', 'authorization=secret', 503, { bearerToken: 'secret' }),
      context,
    );
    const network = publishRequestDiagnosticForError(new TypeError('request included secret credential'), context);

    expect(unknown.message).toBe('The publishing service could not complete the request.');
    expect(unknown.data.serverCode).toBe('FUTURE_SERVER_FAILURE');
    expect(JSON.stringify(unknown)).not.toContain('secret');
    expect(network.message).toBe('UAPKG could not reach the publishing service.');
    expect(JSON.stringify(network)).not.toContain('request included secret');
  });

  it('uses a placeholder instead of placing an unsafe registry alias in a pasteable command', () => {
    const diagnostic = publishRequestDiagnosticForError(
      new ControlPlaneError('REGISTRY_GRANT_INVALID', 'unsafe', 401),
      { ...context, registryAlias: '$(Write-Output compromised)`' },
    );
    const loginCommand = diagnostic.data.resources.find(
      (resource) => resource.kind === 'command' && resource.label === 'Reauthorize this registry login',
    );

    expect(loginCommand).toMatchObject({
      kind: 'command',
      command: 'uapkg login --registry <registry> --reauthorize',
    });
    expect(loginCommand && 'command' in loginCommand ? loginCommand.command : '').not.toContain('Write-Output');
  });
});
