import { z } from 'zod';
import { PluginManifestSchema } from './PluginManifestSchema.ts';
import { ProjectManifestSchema } from './ProjectManifestSchema.ts';

/**
 * Discriminated manifest schema — dispatches to `ProjectManifestSchema`
 * or `PluginManifestSchema` based on the `kind` field.
 */
export const ManifestSchema = z.discriminatedUnion('kind', [ProjectManifestSchema, PluginManifestSchema]);

export type Manifest = z.infer<typeof ManifestSchema>;
