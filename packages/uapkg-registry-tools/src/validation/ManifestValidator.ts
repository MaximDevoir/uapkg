import { createSchemaInvalidDiagnostic, DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import { type PackageRegistryManifest, PackageRegistryManifestSchema } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.js';

/**
 * Validates raw, untrusted manifest data against the registry schema.
 * This is the trust boundary for any manifest content from disk or callers.
 */
export class ManifestValidator {
  constructor(private readonly aggregator: RegistryToolsAggregator) {}

  /** Validate an in-memory candidate manifest. */
  validate(input: unknown, sourceLabel = '<input>'): Result<PackageRegistryManifest> {
    const bag = new DiagnosticBag();
    const result = PackageRegistryManifestSchema.safeParse(input);

    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      const diag = createSchemaInvalidDiagnostic(sourceLabel, issues);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    return ok(result.data, bag.all());
  }
}
