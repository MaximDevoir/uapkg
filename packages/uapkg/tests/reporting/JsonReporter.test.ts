import { describe, expect, it } from 'vite-plus/test';
import { JsonReporter } from '../../src/reporting/JsonReporter.ts';
import { MemoryTextSink } from '../_fakes/MemoryTextSink.ts';

describe('JsonReporter', () => {
  it('emits a single JSON line per call', () => {
    const sink = new MemoryTextSink();
    const reporter = new JsonReporter(sink);
    reporter.emit({ status: 'ok', command: 'add', diagnostics: [], data: { added: 1 } });
    expect(sink.lines).toHaveLength(1);
    const parsed = JSON.parse(sink.lines[0]) as {
      status: string;
      command: string;
      data: { added: number };
      diagnostics: unknown[];
    };
    expect(parsed.status).toBe('ok');
    expect(parsed.command).toBe('add');
    expect(parsed.data.added).toBe(1);
    expect(parsed.diagnostics).toEqual([]);
  });

  it('always includes diagnostics array', () => {
    const sink = new MemoryTextSink();
    const reporter = new JsonReporter(sink);
    reporter.emit({ status: 'error', command: 'install', diagnostics: [] });
    const parsed = JSON.parse(sink.lines[0]) as { diagnostics: unknown[] };
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
  });

  it('builds a success envelope with empty diagnostics by default', () => {
    const sink = new MemoryTextSink();
    const reporter = new JsonReporter(sink);

    reporter.emitSuccess('whoami', { field: 'username', value: 'octocat' });

    expect(JSON.parse(sink.lines[0])).toEqual({
      status: 'ok',
      command: 'whoami',
      data: { field: 'username', value: 'octocat' },
      diagnostics: [],
    });
  });

  it('builds an error envelope without data', () => {
    const sink = new MemoryTextSink();
    const reporter = new JsonReporter(sink);
    const diagnostic = {
      level: 'error' as const,
      code: 'CONTROL_PLANE_COMMAND_FAILED' as const,
      message: 'The account request failed.',
      data: { operation: 'whoami', serverCode: 'ACCOUNT_NOT_FOUND', status: 404 },
    };

    reporter.emitError('whoami', [diagnostic]);

    expect(JSON.parse(sink.lines[0])).toEqual({
      status: 'error',
      command: 'whoami',
      diagnostics: [diagnostic],
    });
  });
});
