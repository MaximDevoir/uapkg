// ---------------------------------------------------------------------------
// @uapkg/diagnostics-format — public API
// ---------------------------------------------------------------------------

export type { DiagnosticFormatterFn, FormatterMap, IFormatterRegistry } from './contracts/FormatterTypes.ts';
export { defaultFormatters } from './defaults/defaultFormatters.ts';
export { installerFormatters } from './formatters/installer/installerFormatters.ts';
export { manifestFormatters } from './formatters/manifest/manifestFormatters.ts';
export { formatPlainText } from './formatters/PlainTextFormatter.ts';
export { postinstallFormatters } from './formatters/postinstall/postinstallFormatters.ts';
export { formatPublishRequestFailed, publishingFormatters } from './formatters/publishing/publishingFormatters.ts';
export { registryFormatters } from './formatters/registry/registryFormatters.ts';
export { registryToolsFormatters } from './formatters/registryTools/registryToolsFormatters.ts';
export { resolverFormatters } from './formatters/resolver/resolverFormatters.ts';
export { safetyFormatters } from './formatters/safety/safetyFormatters.ts';
export { specFormatters } from './formatters/spec/specFormatters.ts';
export { createFormatterRegistry, FormatterRegistry } from './registry/FormatterRegistry.ts';
export { bulletList, indent } from './utils/indent.ts';
