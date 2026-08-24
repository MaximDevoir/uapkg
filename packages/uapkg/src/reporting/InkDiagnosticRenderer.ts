import type { Diagnostic } from '@uapkg/diagnostics';
import { formatPublishRequestFailed } from '@uapkg/diagnostics-format';
import {
  createInkRegistry,
  type DiagnosticInkRegistry,
  DiagnosticsListView,
  defaultInkComponents,
} from '@uapkg/diagnostics-format/ink';
import { render } from 'ink';
import { createElement } from 'react';
import type { DiagnosticRenderer } from './DiagnosticRenderer.ts';
import type { TextSink } from './TextSink.ts';

/**
 * Ink-backed diagnostic renderer.
 *
 * Renders each batch as a static Ink tree to the target process stream. No
 * mount loop, no animations — one-shot render → unmount, so the process can
 * exit immediately after the CLI command finishes.
 *
 * On any Ink failure (missing terminfo, exotic stream, etc.) the renderer
 * delegates to a fallback text sink so diagnostics are never lost.
 */
export class InkDiagnosticRenderer implements DiagnosticRenderer {
  public constructor(
    private readonly registry: DiagnosticInkRegistry = createInkRegistry(defaultInkComponents),
    private readonly fallback?: TextSink,
  ) {}

  public render(diagnostics: readonly Diagnostic[], stream: 'stdout' | 'stderr'): void {
    if (diagnostics.length === 0) return;
    const target = stream === 'stderr' ? process.stderr : process.stdout;
    try {
      const element = createElement(DiagnosticsListView, {
        diagnostics,
        registry: this.registry,
      });
      const instance = render(element, { stdout: target, patchConsole: false });
      instance.unmount();
    } catch {
      if (!this.fallback) return;
      for (const diagnostic of diagnostics) {
        if (diagnostic.code === 'PUBLISH_REQUEST_FAILED') {
          for (const line of formatPublishRequestFailed(diagnostic).split('\n')) this.fallback.writeLine(line);
          continue;
        }
        this.fallback.writeLine(`[${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}`);
        if (diagnostic.hint) this.fallback.writeLine(`  → ${diagnostic.hint}`);
      }
    }
  }
}
