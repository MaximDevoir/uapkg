// ---------------------------------------------------------------------------
// @uapkg/uapkg — public API
//
// Phase 8 + Phase 10 final surface. Legacy exports (`UAPKGManifest`,
// `FileManifestRepository`, `DependencyGraphBuilder`, `TOMLLockfileRepository`,
// `DependencyInstaller`, `SafetyPolicy`, etc.) were removed in Phase 10; use
// `@uapkg/package-manifest` + `@uapkg/package-manifest-schema` instead.
// ---------------------------------------------------------------------------

// Application dispatcher + composition root
export { CompositionRoot, type CompositionRootOptions } from './app/CompositionRoot.js';
export { UAPKGApplication } from './app/UAPKGApplication.js';

// CLI
export { parseUAPKGCommandLine } from './cli/parseCommandLine.js';
export { runUAPKGCLI } from './cli/runUAPKGCLI.js';
export type { UAPKGCommandLine } from './cli/UAPKGCommandLine.js';
export { createUAPKGCommandLineFactory, UAPKGCommandLineFactory } from './cli/UAPKGCommandLine.js';
// Commands — new surface
export { AddCommand, type AddCommandOptions } from './commands/AddCommand.js';
// Commands — retained, ported onto CompositionRoot in Phase 10
export { ConfigCommand } from './commands/ConfigCommand.js';
export { InitCommand, type InitCommandOptions } from './commands/InitCommand.js';
export { InstallCommand, type InstallCommandOptions } from './commands/InstallCommand.js';
export { ListCommand, type ListCommandOptions } from './commands/ListCommand.js';
export { LoginCommand, type LoginCommandOptions } from './commands/LoginCommand.js';
export { LogoutCommand, type LogoutCommandOptions } from './commands/LogoutCommand.js';
export { OutdatedCommand, type OutdatedCommandOptions } from './commands/OutdatedCommand.js';
export { PackCommand } from './commands/PackCommand.js';
export {
  ProjectGetNameCommand,
  type ProjectGetNameCommandOptions,
} from './commands/ProjectGetNameCommand.js';
export { PublishCommand, type PublishCommandOptions } from './commands/PublishCommand.js';
export { RegistryCommand, type RegistryCommandOptions } from './commands/RegistryCommand.js';
export { RemoveCommand, type RemoveCommandOptions } from './commands/RemoveCommand.js';
export { RequestsCommand, type RequestsCommandOptions } from './commands/RequestsCommand.js';
export { UpdateCommand, type UpdateCommandOptions } from './commands/UpdateCommand.js';
export { WhoamiCommand, type WhoamiCommandOptions } from './commands/WhoamiCommand.js';
export { WhyCommand, type WhyCommandOptions } from './commands/WhyCommand.js';
// Control-plane authentication
export {
  type AccessCredential,
  AccountManager,
  type BrowserOpener,
  describeControlPlaneError,
  type LoginOptions,
  type LoginResult,
} from './control-plane/AccountManager.js';
export { AuthMetadataStore } from './control-plane/AuthMetadataStore.js';
export {
  ControlPlaneClient,
  type ControlPlaneCredential,
} from './control-plane/ControlPlaneClient.js';
export * from './control-plane/ControlPlaneTypes.js';
export { CredentialStore, type KeyringLoader } from './control-plane/CredentialStore.js';
export { DPoPKeyStore } from './control-plane/DPoPKeyStore.js';
export {
  FileRegistryGrantLock,
  type FileRegistryGrantLockOptions,
  type RegistryGrantLock,
} from './control-plane/RegistryGrantLock.js';
export {
  canonicalizeRegistryGitOrigin,
  fingerprintRegistryGitOrigin,
  RegistryTrustResolver,
} from './control-plane/RegistryTrustResolver.js';
// Postinstall — new subsystem (Phase 7)
export * from './postinstall/index.js';
// Prompt abstractions (used by init)
export { InkPromptService } from './prompts/InkPromptService.js';
export {
  type ProjectContextDetection,
  ProjectContextDetector,
} from './prompts/ProjectContextDetector.js';
export type { PromptService, SelectOption } from './prompts/PromptService.js';
// Reporting
export { DiagnosticReporter } from './reporting/DiagnosticReporter.js';
export { InstallProgressReporter } from './reporting/InstallProgressReporter.js';
export { type JsonEnvelope, JsonReporter } from './reporting/JsonReporter.js';
