import { RegistryNameSchema } from '@uapkg/common-schema';
import { z } from 'zod';

/**
 * Optional publish configuration within `uapkg.json`.
 */
export const PublishSchema = z.object({
  registry: RegistryNameSchema.optional(),
  owner: z.string().trim().min(1).optional(),
  repository: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 'Expected a GitHub owner/repository coordinate.')
    .optional(),
  asset: z.string().trim().min(1).optional(),
  manifestPath: z.string().trim().min(1).optional(),
});

export type Publish = z.infer<typeof PublishSchema>;
