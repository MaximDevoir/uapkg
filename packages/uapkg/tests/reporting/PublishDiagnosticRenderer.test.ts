import { createPublishRequestFailedDiagnostic, type Diagnostic } from '@uapkg/diagnostics';
import { formatPublishRequestFailed } from '@uapkg/diagnostics-format';
import { describe, expect, it, vi } from 'vite-plus/test';
import { InkDiagnosticRenderer } from '../../src/reporting/InkDiagnosticRenderer.ts';
import { TextDiagnosticRenderer } from '../../src/reporting/TextDiagnosticRenderer.ts';
import { MemoryTextSink } from '../_fakes/MemoryTextSink.ts';

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    render: vi.fn(() => {
      throw new Error('forced Ink failure');
    }),
  };
});

function publishFailure() {
  return createPublishRequestFailedDiagnostic(
    'An organization must be selected before this package can be published.',
    {
      serverCode: 'UNSCOPED_PACKAGE_OWNER_REQUIRED',
      status: 400,
      facts: [
        { kind: 'package', value: 'demo-package' },
        { kind: 'registry', value: 'uapkg' },
      ],
      resources: [
        { kind: 'command', command: 'uapkg publish --owner <organization>' },
        { kind: 'url', label: 'Organizations', url: 'https://account.example/organizations' },
      ],
    },
    'Pass --owner, set publish.owner, or use an organization-scoped package name.',
  );
}

describe('publish diagnostic renderers', () => {
  it('uses the full publish formatter in deterministic text mode', () => {
    const stdout = new MemoryTextSink();
    const stderr = new MemoryTextSink();
    const diagnostic = publishFailure();

    new TextDiagnosticRenderer(stdout, stderr).render([diagnostic], 'stderr');

    expect(stderr.joined()).toBe(formatPublishRequestFailed(diagnostic));
    expect(stdout.lines).toEqual([]);
  });

  it('uses the full publish formatter if Ink rendering fails', () => {
    const fallback = new MemoryTextSink();
    const diagnostic = publishFailure();

    new InkDiagnosticRenderer(undefined, fallback).render([diagnostic], 'stderr');

    expect(fallback.joined()).toBe(formatPublishRequestFailed(diagnostic));
  });

  it('keeps the legacy Ink fallback for every other diagnostic code', () => {
    const fallback = new MemoryTextSink();
    const diagnostic = {
      level: 'error',
      code: 'PARSE_ERROR',
      message: 'The manifest could not be parsed.',
      hint: 'Correct the JSON syntax.',
      data: { reason: 'unexpected token' },
    } satisfies Diagnostic;

    new InkDiagnosticRenderer(undefined, fallback).render([diagnostic], 'stderr');

    expect(fallback.lines).toEqual([
      '[error] PARSE_ERROR: The manifest could not be parsed.',
      '  → Correct the JSON syntax.',
    ]);
  });
});
