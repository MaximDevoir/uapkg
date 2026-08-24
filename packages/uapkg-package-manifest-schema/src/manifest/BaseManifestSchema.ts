import { PackageNameSchema, PackageVersionSchema } from '@uapkg/common-schema';
import { z } from 'zod';
import { DependencySchema } from './DependencySchema.ts';
import { ManifestKindSchema } from './ManifestKind.ts';
import { PublishSchema } from './PublishSchema.ts';

/**
 * Fields shared by all manifest kinds.
 *
 * Loose: unknown top-level members are preserved so read-modify-write
 * commands do not strip fields this build does not understand, and newer
 * optional manifest fields never fail an older client.
 */
export const BaseManifestSchema = z.looseObject({
  name: PackageNameSchema,
  version: PackageVersionSchema,
  kind: ManifestKindSchema,
  private: z.boolean().optional(),
  publish: PublishSchema.optional(),
  dependencies: z.record(z.string(), DependencySchema).optional(),
  devDependencies: z.record(z.string(), DependencySchema).optional(),
  peerDependencies: z.record(z.string(), DependencySchema).optional(),
});

export type BaseManifest = z.infer<typeof BaseManifestSchema>;
