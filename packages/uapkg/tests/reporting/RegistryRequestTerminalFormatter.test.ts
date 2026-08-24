import { describe, expect, it } from 'vite-plus/test';
import type { RegistryRequestDetail } from '../../src/control-plane/ControlPlaneTypes.ts';
import { formatRegistryRequestTerminal } from '../../src/reporting/RegistryRequestTerminalFormatter.ts';

const failedDetail: RegistryRequestDetail = {
  request: {
    id: 'request-failed',
    registryId: '00000000-0000-4000-a000-000000000020',
    kind: 'publish',
    status: 'operationally_failed',
    currentStep: 'checking',
    payload: { packageName: 'example', packageVersion: '1.2.3' },
  },
  checks: [
    {
      checkId: 'publish.package-claims',
      executionState: 'completed',
      conclusion: 'success',
    },
    {
      checkId: 'publish.source-public-access',
      executionState: 'completed',
      conclusion: 'failure',
      reasonCode: 'SOURCE_REPOSITORY_PRIVATE',
    },
    {
      checkId: 'publish.source-revalidation',
      executionState: 'retrying',
      reasonCode: 'PROVIDER_TEMPORARILY_UNAVAILABLE',
    },
  ],
  terminalFailure: {
    reasonCode: 'GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED',
    attempts: 5,
    maxAttempts: 5,
  },
};

describe('formatRegistryRequestTerminal', () => {
  it('renders the same bounded check and operational-failure story for text output', () => {
    const output = formatRegistryRequestTerminal({
      detail: failedDetail,
      registryAlias: 'official',
      outputFormat: 'text',
      presentation: { kind: 'publish' },
    });

    expect(output).toEqual({
      stdout: [
        'Publishing request request-failed: operationally_failed.',
        'Failed checks:',
        '  publish.source-public-access: SOURCE_REPOSITORY_PRIVATE',
        'Operational failure: GITHUB_REGISTRY_APP_INSTALLATION_REQUIRED.',
        'Retry attempts: 5 of 5.',
        '',
      ].join('\n'),
    });
    expect(output.stdout).not.toContain('publish.package-claims');
    expect(output.stdout).not.toContain('publish.source-revalidation');
  });

  it('preserves lifecycle JSON compatibility while adding optional diagnostics', () => {
    const output = formatRegistryRequestTerminal({
      detail: failedDetail,
      registryAlias: 'official',
      outputFormat: 'json',
      presentation: {
        kind: 'lifecycle',
        operation: 'yank',
        packageName: 'example',
        packageVersion: '1.2.3',
      },
    });

    expect(JSON.parse(output.stdout)).toEqual({
      ok: false,
      operation: 'yank',
      registry: 'official',
      requestId: 'request-failed',
      status: 'operationally_failed',
      checks: failedDetail.checks,
      terminalFailure: failedDetail.terminalFailure,
    });
  });

  it('keeps standalone nonterminal request details successful in JSON', () => {
    const detail: RegistryRequestDetail = {
      request: {
        id: 'request-checking',
        registryId: '00000000-0000-4000-a000-000000000020',
        kind: 'publish',
        status: 'checking',
      },
      checks: [{ checkId: 'publish.package-claims', executionState: 'running' }],
    };
    const output = formatRegistryRequestTerminal({
      detail,
      registryAlias: 'official',
      outputFormat: 'json',
      presentation: { kind: 'status' },
    });

    expect(JSON.parse(output.stdout)).toEqual({
      ok: true,
      registry: 'official',
      request: detail.request,
      checks: detail.checks,
    });
  });
});
