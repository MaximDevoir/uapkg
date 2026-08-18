import { RegistryNameSchema, UnixTimestampSchema } from '@uapkg/common-schema';
import { z } from 'zod';

/** Immutable control-plane classification of a UAPKG registry. */
export const RegistryTypeSchema = z.enum(['public', 'private']);

/**
 * Canonical `.uapkg/registry.meta.json` contract.
 *
 * The v1 fields are mandatory. Unknown members are preserved at every object
 * level so compatible optional metadata can be added without breaking older
 * clients, while an unknown `schemaVersion` still fails closed.
 */
export const RegistryMetaSchema = z.looseObject({
  schemaVersion: z.literal(1),
  registry: z.looseObject({
    id: z.uuid(),
    name: RegistryNameSchema,
    normalizedName: RegistryNameSchema,
    registryType: RegistryTypeSchema,
    createdAt: UnixTimestampSchema,
  }),
  owner: z.looseObject({
    kind: z.literal('organization'),
    id: z.uuid(),
    name: z.string().min(1),
    normalizedName: z.string().min(1),
  }),
  sourceOfTruth: z.looseObject({
    type: z.literal('uapkg-service'),
    apiBaseUrl: z.url(),
  }),
  generated: z.looseObject({
    generatedAt: UnixTimestampSchema,
    generatedBy: z.literal('uapkg-registry-app'),
  }),
});

export type RegistryMeta = z.infer<typeof RegistryMetaSchema>;
export type RegistryType = z.infer<typeof RegistryTypeSchema>;
