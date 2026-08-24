import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { AssetHash } from '@uapkg/common-schema';
import {
  createIoErrorDiagnostic,
  createRegistryToolsIntegrityMismatchDiagnostic,
  DiagnosticBag,
  ok,
  type Result,
} from '@uapkg/diagnostics';
import { type Integrity, IntegritySchema } from '@uapkg/registry-schema';
import type { RegistryToolsAggregator } from '../aggregator/RegistryToolsAggregator.ts';
import type { IntegrityAlgorithm, IntegrityVerificationResult } from '../contracts/RegistryToolsTypes.ts';

/**
 * Computes and verifies file integrity locally — never reaches the network.
 */
export class IntegrityCalculator {
  constructor(private readonly aggregator: RegistryToolsAggregator) {}

  /** Stream-hash a local file and return a validated `Integrity` record. */
  async compute(filePath: string, algorithm: IntegrityAlgorithm = 'sha256'): Promise<Result<Integrity>> {
    const bag = new DiagnosticBag();

    const computed = await this.streamHash(filePath, algorithm);
    if (!computed.ok) {
      bag.mergeArray(computed.diagnostics);
      this.aggregator.addMany(computed.diagnostics);
      return bag.toFailure();
    }

    const candidate = {
      hash: `${algorithm}:${computed.value.hex}` as AssetHash,
      size: computed.value.size,
    };

    const validated = IntegritySchema.safeParse(candidate);
    if (!validated.success) {
      // Should not happen unless the algorithm output is malformed.
      const reason = validated.error.issues.map((i) => i.message).join('; ');
      const diag = createIoErrorDiagnostic(filePath, `integrity validation failed: ${reason}`);
      bag.add(diag);
      this.aggregator.add(diag);
      return bag.toFailure();
    }

    return ok(validated.data, bag.all());
  }

  /** Recompute a file's integrity and compare it to an expected value. */
  async verify(filePath: string, expected: Integrity): Promise<Result<IntegrityVerificationResult>> {
    const bag = new DiagnosticBag();
    const algo = parseAlgorithm(expected.hash) ?? 'sha256';

    const computed = await this.compute(filePath, algo);
    if (!computed.ok) {
      bag.mergeArray(computed.diagnostics);
      return bag.toFailure();
    }

    const matches = computed.value.hash === expected.hash && computed.value.size === expected.size;
    if (!matches) {
      const diag = createRegistryToolsIntegrityMismatchDiagnostic(
        filePath,
        expected.hash,
        computed.value.hash,
        expected.size,
        computed.value.size,
      );
      bag.add(diag);
      this.aggregator.add(diag);
    }

    return ok(
      {
        ok: matches,
        actual: computed.value,
        expected,
      },
      bag.all(),
    );
  }

  /** Hash a file by streaming. */
  private streamHash(filePath: string, algorithm: IntegrityAlgorithm): Promise<Result<{ hex: string; size: number }>> {
    return new Promise((resolve) => {
      const bag = new DiagnosticBag();
      const hash = createHash(algorithm);
      let size = 0;
      const stream = createReadStream(filePath);

      stream.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          hash.update(chunk);
          size += chunk.length;
        } else {
          const buf = Buffer.from(chunk);
          hash.update(buf);
          size += buf.length;
        }
      });
      stream.on('error', (err) => {
        const diag = createIoErrorDiagnostic(filePath, err.message);
        bag.add(diag);
        resolve(bag.toFailure());
      });
      stream.on('end', () => {
        resolve(ok({ hex: hash.digest('hex'), size }));
      });
    });
  }
}

function parseAlgorithm(assetHash: string): IntegrityAlgorithm | null {
  const colon = assetHash.indexOf(':');
  if (colon < 0) return null;
  const algo = assetHash.slice(0, colon);
  if (algo === 'sha256' || algo === 'sha512') return algo;
  return null;
}
