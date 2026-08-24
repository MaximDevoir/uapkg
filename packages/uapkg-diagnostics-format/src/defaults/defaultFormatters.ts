import type { FormatterMap } from '../contracts/FormatterTypes.ts';
import { configFormatters } from '../formatters/config/configFormatters.ts';
import { installerFormatters } from '../formatters/installer/installerFormatters.ts';
import { manifestFormatters } from '../formatters/manifest/manifestFormatters.ts';
import { packFormatters } from '../formatters/pack/packFormatters.ts';
import { postinstallFormatters } from '../formatters/postinstall/postinstallFormatters.ts';
import { publishingFormatters } from '../formatters/publishing/publishingFormatters.ts';
import { registryFormatters } from '../formatters/registry/registryFormatters.ts';
import { registryToolsFormatters } from '../formatters/registryTools/registryToolsFormatters.ts';
import { resolverFormatters } from '../formatters/resolver/resolverFormatters.ts';
import { safetyFormatters } from '../formatters/safety/safetyFormatters.ts';
import { specFormatters } from '../formatters/spec/specFormatters.ts';

/**
 * Merged map of all built-in formatters across families.
 */
export const defaultFormatters: FormatterMap = {
  ...resolverFormatters,
  ...configFormatters,
  ...registryFormatters,
  ...registryToolsFormatters,
  ...manifestFormatters,
  ...packFormatters,
  ...installerFormatters,
  ...postinstallFormatters,
  ...publishingFormatters,
  ...safetyFormatters,
  ...specFormatters,
};
