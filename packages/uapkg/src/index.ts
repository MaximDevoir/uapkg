// ---------------------------------------------------------------------------
// @uapkg/uapkg — public API
//
// Phase 8 + Phase 10 final surface. Legacy exports (`UAPKGManifest`,
// `FileManifestRepository`, `DependencyGraphBuilder`, `TOMLLockfileRepository`,
// `DependencyInstaller`, `SafetyPolicy`, etc.) were removed in Phase 10; use
// `@uapkg/package-manifest` + `@uapkg/package-manifest-schema` instead.
// ---------------------------------------------------------------------------

// Application dispatcher + composition root
export { CompositionRoot, type CompositionRootOptions } from './app/CompositionRoot.ts';
export { UAPKGApplication } from './app/UAPKGApplication.ts';

// CLI
export { parseUAPKGCommandLine } from './cli/parseCommandLine.ts';
export { runUAPKGCLI } from './cli/runUAPKGCLI.ts';
export type { UAPKGCommandLine, UAPKGWhoamiField } from './cli/UAPKGCommandLine.ts';
export { createUAPKGCommandLineFactory, UAPKG_WHOAMI_FIELDS, UAPKGCommandLineFactory } from './cli/UAPKGCommandLine.ts';
// Commands — new surface
export { AddCommand, type AddCommandOptions } from './commands/AddCommand.ts';
// Commands — retained, ported onto CompositionRoot in Phase 10
export { ConfigCommand } from './commands/ConfigCommand.ts';
export { InitCommand, type InitCommandOptions } from './commands/InitCommand.ts';
export { InstallCommand, type InstallCommandOptions } from './commands/InstallCommand.ts';
export { ListCommand, type ListCommandOptions } from './commands/ListCommand.ts';
export { LoginCommand, type LoginCommandOptions } from './commands/LoginCommand.ts';
export { LogoutCommand, type LogoutCommandOptions } from './commands/LogoutCommand.ts';
export { OutdatedCommand, type OutdatedCommandOptions } from './commands/OutdatedCommand.ts';
export { PackCommand } from './commands/PackCommand.ts';
export { ProjectGetNameCommand, type ProjectGetNameCommandOptions } from './commands/ProjectGetNameCommand.ts';
export { PublishCommand, type PublishCommandOptions } from './commands/PublishCommand.ts';
export {
  RegistryCommand,
  type RegistryCommandOptions,
  type RegistryCommandRuntime,
} from './commands/RegistryCommand.ts';
export { RemoveCommand, type RemoveCommandOptions } from './commands/RemoveCommand.ts';
export { RequestsCommand, type RequestsCommandOptions } from './commands/RequestsCommand.ts';
export { UpdateCommand, type UpdateCommandOptions } from './commands/UpdateCommand.ts';
export {
  WhoamiCommand,
  type WhoamiCommandData,
  type WhoamiCommandOptions,
  type WhoamiFieldData,
} from './commands/WhoamiCommand.ts';
export { WhyCommand, type WhyCommandOptions } from './commands/WhyCommand.ts';
// Control-plane authentication
export {
  type AccessCredential,
  AccountManager,
  type BrowserOpener,
  controlPlaneDiagnosticForError,
  describeControlPlaneError,
  LoginError,
  type LoginOptions,
  type LoginProgressEvent,
  type LoginResult,
  loginDiagnosticForError,
} from './control-plane/AccountManager.ts';
export { AuthMetadataStore } from './control-plane/AuthMetadataStore.ts';
export { ControlPlaneClient, type ControlPlaneCredential } from './control-plane/ControlPlaneClient.ts';
export * from './control-plane/ControlPlaneTypes.ts';
export { CredentialStore, type KeyringLoader } from './control-plane/CredentialStore.ts';
export { DPoPKeyStore } from './control-plane/DPoPKeyStore.ts';
export {
  FileRegistryGrantLock,
  type FileRegistryGrantLockOptions,
  type RegistryGrantLock,
} from './control-plane/RegistryGrantLock.ts';
export {
  canonicalizeRegistryGitOrigin,
  fingerprintRegistryGitOrigin,
  RegistryTrustResolver,
} from './control-plane/RegistryTrustResolver.ts';
// Postinstall — new subsystem (Phase 7)
export * from './postinstall/index.ts';
// Prompt abstractions (used by init)
export { InkPromptService } from './prompts/InkPromptService.tsx';
export { type ProjectContextDetection, ProjectContextDetector } from './prompts/ProjectContextDetector.ts';
export type { PromptService, SelectOption } from './prompts/PromptService.ts';
// Reporting
export { DiagnosticReporter } from './reporting/DiagnosticReporter.ts';
export { InstallProgressReporter } from './reporting/InstallProgressReporter.ts';
export { type JsonEnvelope, JsonReporter } from './reporting/JsonReporter.ts';
