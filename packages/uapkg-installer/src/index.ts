// ---------------------------------------------------------------------------
// @uapkg/installer — public API
// ---------------------------------------------------------------------------

// Contracts
export type {
  InstallAction,
  InstallActionType,
  InstallerOptions,
  InstallPlan,
  InstallReport,
  InstallSummary,
  PackageInstallOutcome,
  PackageInstallStatus,
} from './contracts/InstallerTypes.ts';
export type {
  BuiltInSafetyPolicyId,
  SafetyContext,
  SafetyEvaluation,
  SafetyPolicy,
} from './contracts/SafetyPolicyTypes.ts';
export type { DownloadStatusSnapshot, InstallTotals, SlotSnapshot, SlotState } from './contracts/StatusStreamTypes.ts';

// Core
export { type ClaimsVerificationInput, ClaimsVerifier } from './core/ClaimsVerifier.ts';
export { type DiskStateEntry, DiskStateInspector } from './core/DiskStateInspector.ts';
export { Installer, type InstallerConstructorOptions } from './core/Installer.ts';
export { InstallPlanner } from './core/InstallPlanner.ts';
export { IntegrityVerifier } from './core/IntegrityVerifier.ts';
export {
  type DownloadOptions,
  type DownloadProgress,
  type DownloadResult,
  PackageDownloader,
} from './core/PackageDownloader.ts';
export { PackageExtractor } from './core/PackageExtractor.ts';
export { PackageRemover } from './core/PackageRemover.ts';

// Safety
export { NoMarkerPolicy } from './safety/NoMarkerPolicy.ts';
export { SafetyPolicyRegistry, type SafetyVerdict } from './safety/SafetyPolicyRegistry.ts';

// Status
export { SlotTable } from './status/SlotTable.ts';
export { StatusStream } from './status/StatusStream.ts';
