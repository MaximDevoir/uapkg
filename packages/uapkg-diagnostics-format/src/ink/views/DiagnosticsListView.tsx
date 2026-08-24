import type { Diagnostic } from '@uapkg/diagnostics';
import { Box } from 'ink';
import type { ReactElement } from 'react';
import type { IDiagnosticInkRegistry } from '../contracts/InkTypes.ts';
import { DiagnosticView } from './DiagnosticView.tsx';

export interface DiagnosticsListViewProps {
  readonly diagnostics: readonly Diagnostic[];
  readonly registry: IDiagnosticInkRegistry;
}

/**
 * Renders a list of diagnostics (already pre-sorted by the caller — usually
 * severity-descending). Produces nothing for an empty input so the host
 * Ink tree stays quiet.
 */
export function DiagnosticsListView({ diagnostics, registry }: DiagnosticsListViewProps): ReactElement | null {
  if (diagnostics.length === 0) return null;
  return (
    <Box flexDirection="column">
      {diagnostics.map((diagnostic, i) => {
        // Diagnostics don't carry stable ids; the (code, message, index) triple
        // is stable for a one-shot static render and unique within the list.
        const key = `${diagnostic.code}:${i}:${diagnostic.message.length}`;
        return <DiagnosticView key={key} diagnostic={diagnostic} registry={registry} />;
      })}
    </Box>
  );
}
