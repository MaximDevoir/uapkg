import { describe, expect, it } from 'vite-plus/test';
import type {
  Diagnostic,
  DiagnosticByCode,
  PublishDiagnosticFact,
  PublishDiagnosticResource,
  PublishRequestFailedDiagnostic,
} from '../src/index.js';
import { createPublishRequestFailedDiagnostic } from '../src/index.js';

describe('Publishing diagnostics', () => {
  it('exposes a strongly typed publish failure through the unified union', () => {
    const facts: PublishDiagnosticFact[] = [
      { kind: 'package', value: 'demo-package' },
      { kind: 'requested-owner', value: 'acme' },
      { kind: 'token-owner', value: 'other-org' },
      { kind: 'missing-capability', value: 'publish new versions' },
    ];
    const resources: PublishDiagnosticResource[] = [
      { kind: 'command', command: 'uapkg publish --help' },
      {
        kind: 'url',
        label: 'Access tokens',
        url: 'https://account.example/settings/access-tokens',
      },
    ];

    const diagnostic: PublishRequestFailedDiagnostic = createPublishRequestFailedDiagnostic(
      'This credential cannot publish the package for the requested organization.',
      {
        serverCode: 'GAT_OWNER_ORGANIZATION_MISMATCH',
        status: 403,
        facts,
        resources,
      },
      'Choose the matching organization or use one of its access tokens.',
    );
    const unified: Diagnostic = diagnostic;
    const byCode: DiagnosticByCode<'PUBLISH_REQUEST_FAILED'> = diagnostic;

    expect(unified.level).toBe('error');
    expect(byCode.data).toEqual({
      serverCode: 'GAT_OWNER_ORGANIZATION_MISMATCH',
      status: 403,
      facts,
      resources,
    });
    expect(byCode.hint).toBe('Choose the matching organization or use one of its access tokens.');
  });

  it('supports repository and access-policy mismatch facts without arbitrary detail objects', () => {
    const facts: PublishDiagnosticFact[] = [
      { kind: 'allowed-owner', value: 'acme' },
      { kind: 'actual-access-mode', value: 'existing packages' },
      { kind: 'required-access-mode', value: 'new packages' },
      { kind: 'requested-repository', value: 'acme/submitted' },
      { kind: 'trusted-repository', value: 'acme/trusted' },
      { kind: 'request-id', value: 'request-123' },
      { kind: 'retry-after', value: '30 seconds' },
    ];

    expect(facts.map((fact) => fact.kind)).toEqual([
      'allowed-owner',
      'actual-access-mode',
      'required-access-mode',
      'requested-repository',
      'trusted-repository',
      'request-id',
      'retry-after',
    ]);
  });
});
