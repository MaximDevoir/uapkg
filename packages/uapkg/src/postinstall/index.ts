// ---------------------------------------------------------------------------
// New postinstall subsystem — public surface.
//
// The legacy flat files in this directory (PostinstallRunner, BuildCsInjector,
// etc.) remain in place until Phase 10 prunes them, so `packages/uapkg/src/
// index.ts` keeps compiling. New consumers (Phase 8 CLI) should import from
// this barrel only.
// ---------------------------------------------------------------------------

export { definePostinstall } from '#cli/postinstall/api/definePostinstall.ts';
// API
export type {
  PostinstallDefinition,
  ProjectSetupDefinition,
  ZoneDefinition,
} from '#cli/postinstall/api/PostinstallDsl.ts';
export { PostinstallDefinitionSchema, ProjectSetupSchema, ZoneSchema } from '#cli/postinstall/api/PostinstallDsl.ts';

// Loader
export { EntryResolver, type PostinstallEntryKind, type ResolvedEntry } from '#cli/postinstall/loader/EntryResolver.ts';
export { EsbuildTranspiler } from '#cli/postinstall/loader/EsbuildTranspiler.ts';
export { ExportValidator } from '#cli/postinstall/loader/ExportValidator.ts';
export { ModuleImporter, type ModuleSource } from '#cli/postinstall/loader/ModuleImporter.ts';
export { type LoadedPostinstall, PostinstallLoader } from '#cli/postinstall/loader/PostinstallLoader.ts';
// Markers
export { MarkerBlockEditor } from '#cli/postinstall/markers/MarkerBlockEditor.ts';
export { MarkerBlockService } from '#cli/postinstall/markers/MarkerBlockService.ts';
export {
  type MarkerIntegrityFail,
  type MarkerIntegrityOk,
  type MarkerIntegrityResult,
  MarkerIntegrityValidator,
} from '#cli/postinstall/markers/MarkerIntegrityValidator.ts';
// Policy
export {
  type PolicyConfigReader,
  type PolicyDecision,
  PostinstallPolicyGate,
} from '#cli/postinstall/policy/PostinstallPolicyGate.ts';
// Runner
export {
  type PostinstallCandidate,
  PostinstallOrchestrator,
  type PostinstallOrchestratorInput,
  type PostinstallReport,
} from '#cli/postinstall/runner/PostinstallOrchestrator.ts';
// Unreal
export { BuildCsInjector } from '#cli/postinstall/unreal/BuildCsInjector.ts';
export { CSharpInjectionEngine } from '#cli/postinstall/unreal/CSharpInjectionEngine.ts';
export { CSharpStructureAnalyzer } from '#cli/postinstall/unreal/CSharpStructureAnalyzer.ts';
export type {
  CSharpFileKind,
  ParsedClass,
  ParsedConstructor,
  ParsedCSharpFile,
} from '#cli/postinstall/unreal/CSharpStructures.ts';
export { CSharpWrapperFactory, type WrapperContextType } from '#cli/postinstall/unreal/CSharpWrapperFactory.ts';
export { getPluginHash, getWrapperClassName } from '#cli/postinstall/unreal/PluginHash.ts';
export { PrettyParseError } from '#cli/postinstall/unreal/PrettyParseError.ts';
export { ProjectFileLocator } from '#cli/postinstall/unreal/ProjectFileLocator.ts';
export { TargetCsInjector } from '#cli/postinstall/unreal/TargetCsInjector.ts';
export { type SourceCatalog, UnrealSourceCatalogBuilder } from '#cli/postinstall/unreal/UnrealSourceCatalog.ts';
export { UProjectInjector } from '#cli/postinstall/unreal/UProjectInjector.ts';
export { UProjectMetadataReader } from '#cli/postinstall/unreal/UProjectMetadataReader.ts';
