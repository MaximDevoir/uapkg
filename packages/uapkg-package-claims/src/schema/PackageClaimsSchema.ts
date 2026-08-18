import { PackageNameSchema, PackageVersionSchema, RegistryNameSchema, VersionRangeSchema } from '@uapkg/common-schema';
import { z } from 'zod';

/** A dependency claim in the canonical published-claims representation. */
export const ClaimedDependencySchema = z
  .object({
    version: VersionRangeSchema,
    registry: RegistryNameSchema.optional(),
  })
  .strict();

type ClaimedDependencyRecord = Record<string, z.output<typeof ClaimedDependencySchema>>;
type ClaimedDependencyRecordInput = Record<string, z.input<typeof ClaimedDependencySchema>>;

// Retain ergonomic string-keyed TypeScript records while keeping the shared
// PackageNameSchema as the executable key schema for OpenAPI/JSON Schema.
const ClaimedDependencyRecordSchema = z.record(PackageNameSchema, ClaimedDependencySchema) as unknown as z.ZodType<
  ClaimedDependencyRecord,
  ClaimedDependencyRecordInput
>;

/**
 * The normalized mandatory publication-claims core.
 *
 * The request-facing claims contract is strict: only explicitly versioned
 * claim members can cross the admission boundary.
 */
export const PackageClaimsSchema = z
  .object({
    name: PackageNameSchema,
    version: PackageVersionSchema,
    private: z.boolean(),
    dependencies: ClaimedDependencyRecordSchema,
    devDependencies: ClaimedDependencyRecordSchema,
    peerDependencies: ClaimedDependencyRecordSchema,
  })
  .strict();

export type ClaimedDependency = z.infer<typeof ClaimedDependencySchema>;
export type PackageClaims = z.infer<typeof PackageClaimsSchema>;
