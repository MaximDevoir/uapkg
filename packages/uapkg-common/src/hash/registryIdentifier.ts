import { stableStringify } from '../json/stableStringify.js';
import { normalizeUrl } from '../normalize/normalizeUrl.js';
import { sha256 } from './sha256.js';

/**
 * Descriptor shape for a registry identity (mirrors `registries.<name>` from config).
 */
export interface RegistryIdentityDescriptor {
  url: string;
  ref: {
    type: string;
    value: string;
  };
}

/**
 * Compute the full `RegistryIdentifier` (64-char hex SHA-256) from a
 * `registries.<name>` config object.
 *
 * Steps:
 *   1. Normalize the Git repository identity.
 *   2. Trim the ref value while preserving its case.
 *   3. Deep-sort keys via stable JSON serialization.
 *   4. SHA-256 the resulting string.
 */
export function computeRegistryIdentifier(descriptor: RegistryIdentityDescriptor): string {
  const normalized: RegistryIdentityDescriptor = {
    url: normalizeUrl(descriptor.url),
    ref: {
      type: descriptor.ref.type,
      value: descriptor.ref.value.trim(),
    },
  };
  return sha256(stableStringify(normalized));
}

/**
 * Compute the short identifier (first 16 hex chars / 64 bits).
 */
export function computeRegistryIdentifierShort(descriptor: RegistryIdentityDescriptor): string {
  return computeRegistryIdentifier(descriptor).slice(0, 16);
}
