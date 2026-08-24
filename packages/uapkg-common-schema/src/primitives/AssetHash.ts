import { z } from 'zod';
import type { Brand } from '../brand/Brand.ts';

/**
 * Branded type for an asset integrity hash.
 * Exactly `sha256:` followed by 64 lowercase hexadecimal characters.
 */
export type AssetHash = Brand<string, 'AssetHash'>;

export const AssetHashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, 'Must be "sha256:" followed by 64 lowercase hex characters')
  .brand('AssetHash');
