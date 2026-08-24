import { configInkComponents } from '../components/configInkComponents.tsx';
import { installerInkComponents } from '../components/installerInkComponents.tsx';
import { manifestInkComponents } from '../components/manifestInkComponents.tsx';
import { packInkComponents } from '../components/packInkComponents.tsx';
import { postinstallInkComponents } from '../components/postinstallInkComponents.tsx';
import { publishingInkComponents } from '../components/publishingInkComponents.tsx';
import { registryInkComponents } from '../components/registryInkComponents.tsx';
import { resolverInkComponents } from '../components/resolverInkComponents.tsx';
import { safetyInkComponents } from '../components/safetyInkComponents.tsx';
import { specInkComponents } from '../components/specInkComponents.tsx';
import type { DiagnosticInkComponentMap } from '../contracts/InkTypes.ts';

/**
 * Aggregated default Ink component map — one entry per well-known diagnostic
 * code. Unknown codes fall back to {@link PlainTextBody} inside
 * {@link DiagnosticView}, so the registry is always safe to call.
 *
 * Consumers that want custom behavior can either:
 *
 *   1. Pass a spread: `{ ...defaultInkComponents, MY_CODE: MyBody }`, or
 *   2. Instantiate a {@link DiagnosticInkRegistry} and `.register()` after.
 */
export const defaultInkComponents: DiagnosticInkComponentMap = {
  ...configInkComponents,
  ...installerInkComponents,
  ...manifestInkComponents,
  ...packInkComponents,
  ...postinstallInkComponents,
  ...publishingInkComponents,
  ...registryInkComponents,
  ...resolverInkComponents,
  ...safetyInkComponents,
  ...specInkComponents,
};
