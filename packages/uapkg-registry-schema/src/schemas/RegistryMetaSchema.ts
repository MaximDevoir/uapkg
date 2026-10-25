import { RegistryNameSchema } from '@uapkg/common-schema';
import { z } from 'zod';

/** Immutable control-plane classification of a UAPKG registry. */
export const RegistryTypeSchema = z.enum(['public', 'private']);

/**
 * Canonical `.uapkg/registry.meta.json` contract.
 *
 * The v1 core retains registry selection, display name, and package-policy
 * context. Unknown members remain tolerated and preserved, including richer
 * existing v1 files, while an unknown `schemaVersion` still fails closed.
 */
export const RegistryMetaSchema = z.looseObject({
  schemaVersion: z.literal(1),
  registry: z.looseObject({
    id: z.uuid(),
    name: RegistryNameSchema,
    registryType: RegistryTypeSchema,
  }),
});

export type RegistryMeta = z.infer<typeof RegistryMetaSchema>;
export type RegistryType = z.infer<typeof RegistryTypeSchema>;
