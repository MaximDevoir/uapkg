import { PackageNameSchema } from '@uapkg/common-schema';
import { z } from 'zod';
import { LockDependencySchema } from './LockDependencySchema.js';

/** Lockfile versions this build understands. Unknown versions fail closed. */
export const SUPPORTED_LOCKFILE_VERSIONS = [1] as const;

/**
 * Schema for `uapkg.lock`. `lockfileVersion` dispatches exact supported
 * values; an unrecognized version means the lockfile was written by a newer
 * client and must not be reinterpreted.
 */
export const LockfileSchema = z.object({
  lockfileVersion: z.literal(SUPPORTED_LOCKFILE_VERSIONS),
  packages: z.record(PackageNameSchema, LockDependencySchema),
});

export type Lockfile = z.infer<typeof LockfileSchema>;
