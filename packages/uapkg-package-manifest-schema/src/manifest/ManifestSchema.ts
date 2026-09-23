import { z } from 'zod';
import { PluginManifestSchema } from '#package-manifest-schema/manifest/PluginManifestSchema.ts';
import { ProjectManifestSchema } from '#package-manifest-schema/manifest/ProjectManifestSchema.ts';

/**
 * Discriminated manifest schema — dispatches to `ProjectManifestSchema`
 * or `PluginManifestSchema` based on the `kind` field.
 */
export const ManifestSchema = z.discriminatedUnion('kind', [ProjectManifestSchema, PluginManifestSchema]);

export type Manifest = z.infer<typeof ManifestSchema>;
