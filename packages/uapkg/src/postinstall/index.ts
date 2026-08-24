// ---------------------------------------------------------------------------
// New postinstall subsystem — public surface.
//
// The legacy flat files in this directory (PostinstallRunner, BuildCsInjector,
// etc.) remain in place until Phase 10 prunes them, so `packages/uapkg/src/
// index.ts` keeps compiling. New consumers (Phase 8 CLI) should import from
// this barrel only.
// ---------------------------------------------------------------------------

export { definePostinstall } from './api/definePostinstall.ts';
// API
export type { PostinstallDefinition, ProjectSetupDefinition, ZoneDefinition } from './api/PostinstallDsl.ts';
export { PostinstallDefinitionSchema, ProjectSetupSchema, ZoneSchema } from './api/PostinstallDsl.ts';

// Loader
export { EntryResolver, type PostinstallEntryKind, type ResolvedEntry } from './loader/EntryResolver.ts';
export { EsbuildTranspiler } from './loader/EsbuildTranspiler.ts';
export { ExportValidator } from './loader/ExportValidator.ts';
export { ModuleImporter, type ModuleSource } from './loader/ModuleImporter.ts';
export { type LoadedPostinstall, PostinstallLoader } from './loader/PostinstallLoader.ts';
// Markers
export { MarkerBlockEditor } from './markers/MarkerBlockEditor.ts';
export { MarkerBlockService } from './markers/MarkerBlockService.ts';
export {
  type MarkerIntegrityFail,
  type MarkerIntegrityOk,
  type MarkerIntegrityResult,
  MarkerIntegrityValidator,
} from './markers/MarkerIntegrityValidator.ts';
// Policy
export { type PolicyConfigReader, type PolicyDecision, PostinstallPolicyGate } from './policy/PostinstallPolicyGate.ts';
// Runner
export {
  type PostinstallCandidate,
  PostinstallOrchestrator,
  type PostinstallOrchestratorInput,
  type PostinstallReport,
} from './runner/PostinstallOrchestrator.ts';
// Unreal
export { BuildCsInjector } from './unreal/BuildCsInjector.ts';
export { CSharpInjectionEngine } from './unreal/CSharpInjectionEngine.ts';
export { CSharpStructureAnalyzer } from './unreal/CSharpStructureAnalyzer.ts';
export type { CSharpFileKind, ParsedClass, ParsedConstructor, ParsedCSharpFile } from './unreal/CSharpStructures.ts';
export { CSharpWrapperFactory, type WrapperContextType } from './unreal/CSharpWrapperFactory.ts';
export { getPluginHash, getWrapperClassName } from './unreal/PluginHash.ts';
export { PrettyParseError } from './unreal/PrettyParseError.ts';
export { ProjectFileLocator } from './unreal/ProjectFileLocator.ts';
export { TargetCsInjector } from './unreal/TargetCsInjector.ts';
export { type SourceCatalog, UnrealSourceCatalogBuilder } from './unreal/UnrealSourceCatalog.ts';
export { UProjectInjector } from './unreal/UProjectInjector.ts';
export { UProjectMetadataReader } from './unreal/UProjectMetadataReader.ts';
