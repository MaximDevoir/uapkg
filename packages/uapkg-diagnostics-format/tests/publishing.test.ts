import { createPublishRequestFailedDiagnostic } from '@uapkg/diagnostics';
import { renderToString } from 'ink';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import {
  createFormatterRegistry,
  defaultFormatters,
  formatPublishRequestFailed,
  publishingFormatters,
} from '../src/index.js';
import { createInkRegistry, DiagnosticView, defaultInkComponents, publishingInkComponents } from '../src/ink/index.js';

function publishFailure() {
  return createPublishRequestFailedDiagnostic(
    'The selected token was created for a different organization.',
    {
      serverCode: 'GAT_OWNER_ORGANIZATION_MISMATCH',
      status: 403,
      facts: [
        { kind: 'package', value: 'demo-package' },
        { kind: 'requested-owner', value: 'acme' },
        { kind: 'token-owner', value: 'other-org' },
      ],
      resources: [
        { kind: 'command', command: 'uapkg publish --help' },
        { kind: 'url', label: 'Access tokens', url: 'https://account.example/settings/access-tokens' },
      ],
    },
    'Publish for "other-org", or use a token created for "acme".',
  );
}

describe('publish diagnostic formatting', () => {
  it('renders problem, facts, server metadata, fix, and resources in order', () => {
    const diagnostic = publishFailure();

    expect(formatPublishRequestFailed(diagnostic)).toBe(
      [
        '[ERROR PUBLISH_REQUEST_FAILED]: The selected token was created for a different organization.',
        '  Package: demo-package',
        '  Requested owner: acme',
        '  Token owner: other-org',
        '  Server code: GAT_OWNER_ORGANIZATION_MISMATCH',
        '  HTTP status: 403',
        '  → Publish for "other-org", or use a token created for "acme".',
        '  Command: uapkg publish --help',
        '  Access tokens: https://account.example/settings/access-tokens',
      ].join('\n'),
    );
  });

  it('registers the formatter in both the family and default maps', () => {
    const diagnostic = publishFailure();
    const registry = createFormatterRegistry(defaultFormatters);

    expect(publishingFormatters.PUBLISH_REQUEST_FAILED).toBe(formatPublishRequestFailed);
    expect(defaultFormatters.PUBLISH_REQUEST_FAILED).toBe(formatPublishRequestFailed);
    expect(registry.format(diagnostic)).toBe(formatPublishRequestFailed(diagnostic));
  });

  it('renders the same facts and resources through the default Ink component', () => {
    const diagnostic = publishFailure();
    const output = renderToString(
      createElement(DiagnosticView, {
        diagnostic,
        registry: createInkRegistry(defaultInkComponents),
      }),
      { columns: 200 },
    );
    const orderedText = [
      diagnostic.message,
      'Package:',
      'demo-package',
      'Requested owner:',
      'acme',
      'Token owner:',
      'other-org',
      'Server code:',
      'GAT_OWNER_ORGANIZATION_MISMATCH',
      'HTTP status:',
      '403',
      diagnostic.hint ?? '',
      'Command:',
      'uapkg publish --help',
      'Access tokens:',
      'https://account.example/settings/access-tokens',
    ];

    let previousIndex = -1;
    for (const text of orderedText) {
      const nextIndex = output.indexOf(text, previousIndex + 1);
      expect(nextIndex, `expected Ink output to contain "${text}" after index ${previousIndex}`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = nextIndex;
    }
    expect(output.split(diagnostic.hint ?? '').length - 1).toBe(1);
    expect(publishingInkComponents.PUBLISH_REQUEST_FAILED).toBe(defaultInkComponents.PUBLISH_REQUEST_FAILED);
  });
});
