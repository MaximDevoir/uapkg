import { PackageNameSchema, PackageVersionSchema } from '@uapkg/common-schema';
import { z } from 'zod';
import { PackageSourceSchema } from './PackageSourceSchema.js';
import type { RegistryType } from './RegistryMetaSchema.js';
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

/**
 * Add the trusted registry-type policy to the structural package schema.
 * Public registry versions must identify their source Git tree; private
 * registry versions may omit it.
 */
export function createPackageRegistryManifestSchema(registryType: RegistryType) {
  return PackageRegistryManifestSchema.superRefine((manifest, context) => {
    if (registryType !== 'public') return;
    for (const [version, entry] of Object.entries(manifest.versions)) {
      if (entry.gitTree !== undefined) continue;
      context.addIssue({
        code: 'custom',
        path: ['versions', version, 'gitTree'],
        message: 'Public registry versions must include gitTree.',
      });
    }
  });
}

export type PackageRegistryManifest = z.infer<typeof PackageRegistryManifestSchema>;
