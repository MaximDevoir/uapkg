import type { RegistryIdentifier } from '@uapkg/common-schema';
import type { Diagnostic } from '@uapkg/diagnostics';
import { describe, expect, it } from 'vite-plus/test';
import { Registry } from '../src/registry/Registry.ts';

describe('Registry unreachable diagnostics', () => {
  it('do not expose credentials, query data, or fragments', () => {
    const url = 'https://alice:password@example.test/acme/registry?token=query-secret#fragment-secret';
    const registry = Registry.create(
      'private',
      { type: 'git', url, ref: { type: 'branch', value: 'main' } },
      'a'.repeat(64) as RegistryIdentifier,
      'diagnostic-redaction',
      'git',
      300,
    );
    const internals = registry as unknown as {
      toRegistryUnreachableDiagnostic(
        diagnostics: readonly Diagnostic[],
        initialized: boolean,
        logicalRegistryName?: string,
      ): Diagnostic;
    };

    const diagnostic = internals.toRegistryUnreachableDiagnostic(
      [
        {
          level: 'error',
          code: 'GIT_ERROR',
          message: `Git failed for ${url}: alice password query-secret fragment-secret`,
          data: { command: `git ls-remote ${url}`, stderr: url, exitCode: 128 },
        },
      ],
      false,
      'private',
    );
    const serialized = JSON.stringify(diagnostic);

    expect(serialized).not.toContain('alice');
    expect(serialized).not.toContain('password');
    expect(serialized).not.toContain('query-secret');
    expect(serialized).not.toContain('fragment-secret');
    expect(serialized).toContain('https://example.test/acme/registry');
    expect(diagnostic.message).toContain('Git could not access');
    expect(diagnostic.hint).toContain('uapkg registry auth private');
  });
});
