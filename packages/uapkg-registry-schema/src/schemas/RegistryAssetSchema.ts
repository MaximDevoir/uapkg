import { z } from 'zod';
import { IntegritySchema } from '#registry-schema/schemas/IntegritySchema.ts';

/**
 * A downloadable release asset with integrity metadata.
 */
export const RegistryAssetSchema = z
  .object({
    url: z.url(),
    integrity: IntegritySchema,
  })
  .strict();

export type RegistryAsset = z.infer<typeof RegistryAssetSchema>;
