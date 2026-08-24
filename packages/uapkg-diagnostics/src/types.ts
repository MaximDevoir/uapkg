import type { ConfigDiagnostic } from './config/ConfigDiagnostics.ts';
import type { ControlPlaneDiagnostic } from './controlPlane/ControlPlaneDiagnostics.ts';
import type { GeneralDiagnostic } from './general/GeneralDiagnostics.ts';
import type { InstallerDiagnostic } from './installer/InstallerDiagnostics.ts';
import type { ManifestDiagnostic } from './manifest/ManifestDiagnostics.ts';
import type { PackDiagnostic } from './pack/PackDiagnostics.ts';
import type { PostinstallDiagnostic } from './postinstall/PostinstallDiagnostics.ts';
import type { PublishingDiagnostic } from './publishing/PublishingDiagnostics.ts';
import type { RegistryDiagnostic } from './registry/RegistryDiagnostics.ts';
import type { RegistryToolsDiagnostic } from './registryTools/RegistryToolsDiagnostics.ts';
import type { ResolverDiagnostic } from './resolver/ResolverDiagnostics.ts';
import type { SafetyDiagnostic } from './safety/SafetyDiagnostics.ts';
import type { SpecParseDiagnostic } from './spec/SpecDiagnostics.ts';

/**
 * The unified Diagnostic type — a discriminated union of every known
 * diagnostic, keyed on `code`.
 *
 * To add a new diagnostic:
 *   1. Create its type in the appropriate family file.
 *   2. Add it to that family's union.
 *   3. It is automatically part of `Diagnostic` through this re-export.
 */
export type Diagnostic =
  | ResolverDiagnostic
  | ControlPlaneDiagnostic
  | ConfigDiagnostic
  | RegistryDiagnostic
  | RegistryToolsDiagnostic
  | ManifestDiagnostic
  | PackDiagnostic
  | GeneralDiagnostic
  | InstallerDiagnostic
  | PostinstallDiagnostic
  | PublishingDiagnostic
  | SafetyDiagnostic
  | SpecParseDiagnostic;

/**
 * Extract a specific diagnostic by code.
 *
 * @example
 * type VC = DiagnosticByCode<'VERSION_CONFLICT'>;
 */
export type DiagnosticByCode<C extends Diagnostic['code']> = Extract<Diagnostic, { code: C }>;

/** All known diagnostic codes. */
export type DiagnosticCode = Diagnostic['code'];
