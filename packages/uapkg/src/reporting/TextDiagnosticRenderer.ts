import type { Diagnostic } from '@uapkg/diagnostics';
import { formatPublishRequestFailed } from '@uapkg/diagnostics-format';
import type { DiagnosticRenderer } from './DiagnosticRenderer.ts';
import type { TextSink } from './TextSink.ts';

/**
 * Plain-text diagnostic renderer — used by tests and by any non-TTY path
 * that prefers a deterministic string output over Ink. Stable format:
 *
 *   [<icon>] <message>
 *     → <hint>
 *
 * Icons mirror the legacy reporter so existing log-parsers still match:
 * `x` (error), `!` (warning), `i` (info).
 */
export class TextDiagnosticRenderer implements DiagnosticRenderer {
  public constructor(
    private readonly stdout: TextSink,
    private readonly stderr: TextSink,
  ) {}

  public render(diagnostics: readonly Diagnostic[], stream: 'stdout' | 'stderr'): void {
    if (diagnostics.length === 0) return;
    const sink = stream === 'stderr' ? this.stderr : this.stdout;
    for (const diagnostic of diagnostics) {
      if (diagnostic.code === 'PUBLISH_REQUEST_FAILED') {
        for (const line of formatPublishRequestFailed(diagnostic).split('\n')) sink.writeLine(line);
        continue;
      }
      const icon = diagnostic.level === 'error' ? 'x' : diagnostic.level === 'warning' ? '!' : 'i';
      sink.writeLine(`[${icon}] ${diagnostic.message}`);
      if (diagnostic.hint) sink.writeLine(`  → ${diagnostic.hint}`);
    }
  }
}
