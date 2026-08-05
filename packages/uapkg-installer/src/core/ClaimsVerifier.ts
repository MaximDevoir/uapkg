import type { PackageName, PackageVersion } from '@uapkg/common-schema';
import { DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import { claimsFromRegistryVersion, compareClaims, readPackageClaimsFromArchive } from '@uapkg/package-claims';
import type { RegistryVersion } from '@uapkg/registry-schema';

export interface ClaimsVerificationInput {
  readonly packageName: PackageName;
  readonly version: PackageVersion;
  readonly archivePath: string;
  readonly registryEntry: RegistryVersion;
  readonly registryType?: 'public' | 'private';
}

/**
 * Install-time packaged-manifest verification: the registry record's claims
 * must agree with the packaged `uapkg.json` over the mandatory core plus the
 * shared understood keys, and a `public` registry rejects `private: true`.
 * Byte size and SHA-256 are verified separately before this step.
 */
export class ClaimsVerifier {
  async verify(input: ClaimsVerificationInput): Promise<Result<void>> {
    const bag = new DiagnosticBag();

    const packaged = await readPackageClaimsFromArchive(input.archivePath);
    if (!packaged.ok) {
      bag.mergeArray(packaged.diagnostics);
      return bag.toFailure();
    }

    // Public registry type rule applies to the actual packaged manifest.
    if (input.registryType === 'public' && packaged.value.private) {
      bag.addError(
        'INSTALL_PRIVATE_PACKAGE_IN_PUBLIC_REGISTRY',
        `Package "${input.packageName}" declares private: true but was resolved from a public registry.`,
        { packageName: input.packageName, version: input.version },
      );
      return bag.toFailure();
    }

    const registryClaims = claimsFromRegistryVersion(input.packageName, input.version, input.registryEntry);
    const comparison = compareClaims(packaged.value, registryClaims);
    if (!comparison.equal) {
      bag.addError(
        'INSTALL_MANIFEST_CLAIMS_MISMATCH',
        `Packaged manifest of "${input.packageName}@${input.version}" disagrees with the registry record on: ${comparison.differences
          .map((difference) => difference.key)
          .join(', ')}.`,
        {
          packageName: input.packageName,
          version: input.version,
          packagedHash: comparison.packagedHash,
          registryHash: comparison.registryHash,
          differences: comparison.differences,
        },
      );
      return bag.toFailure();
    }

    return ok(undefined);
  }
}
