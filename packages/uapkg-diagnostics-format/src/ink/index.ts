// ---------------------------------------------------------------------------
// @uapkg/diagnostics-format — Ink surface
//
// This is the "standardized component factory" subpath every consumer should
// import from when they want to render diagnostics as Ink elements.
//
// Plain-data helpers (formatters returning strings) remain exported from the
// package root; Ink helpers live here so consumers that don't ship a TTY UI
// pay zero React/Ink cost.
// ---------------------------------------------------------------------------

// Family component maps — exported individually so consumers can cherry-pick.
export { installerInkComponents } from './components/installerInkComponents.tsx';
export { manifestInkComponents } from './components/manifestInkComponents.tsx';
export { postinstallInkComponents } from './components/postinstallInkComponents.tsx';
export { publishingInkComponents } from './components/publishingInkComponents.tsx';
export { registryInkComponents } from './components/registryInkComponents.tsx';
export { resolverInkComponents } from './components/resolverInkComponents.tsx';
export { safetyInkComponents } from './components/safetyInkComponents.tsx';
export { specInkComponents } from './components/specInkComponents.tsx';
export type {
  DiagnosticBodyComponent,
  DiagnosticBodyProps,
  DiagnosticInkComponentMap,
  IDiagnosticInkRegistry,
} from './contracts/InkTypes.ts';
export { defaultInkComponents } from './defaults/defaultInkComponents.ts';
// Primitives.
export { HintLine } from './primitives/HintLine.tsx';
export { PlainTextBody } from './primitives/PlainTextBody.tsx';
export { SeverityBadge } from './primitives/SeverityBadge.tsx';
export { createInkRegistry, DiagnosticInkRegistry } from './registry/DiagnosticInkRegistry.ts';
export { DiagnosticsListView, type DiagnosticsListViewProps } from './views/DiagnosticsListView.tsx';
// Views.
export { DiagnosticView, type DiagnosticViewProps } from './views/DiagnosticView.tsx';
