import { PackageNameSchema, PackageVersionSchema } from '@uapkg/common-schema';
import { z } from 'zod';
import { PackageSourceSchema } from './PackageSourceSchema.js';
import { RegistryVersionSchema } from './RegistryVersionSchema.js';

/**
 * The top-level package registry manifest — one per package in the registry repo.
 *
 * File layout: `packages/{first-letter}/{package-name}.json` for unscoped
 * names and `packages/@{scope}/{package-name}.json` for scoped names.
 * Unknown optional members are tolerated rather than rejected so newer
 * records do not break older clients.
 */
export const PackageRegistryManifestSchema = z.object({
  name: PackageNameSchema,
  packageSource: PackageSourceSchema,
  versions: z.record(PackageVersionSchema, RegistryVersionSchema),
});

export type PackageRegistryManifest = z.infer<typeof PackageRegistryManifestSchema>;
