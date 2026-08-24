import { z } from 'zod';
import type { Brand } from '../brand/Brand.ts';

/**
 * Branded integer representing a duration in seconds (non-negative).
 * Used for network timeouts, retry delays, cache TTLs.
 */
export type DurationSeconds = Brand<number, 'DurationSeconds'>;

export const DurationSecondsSchema = z
  .number()
  .int()
  .min(0, 'Duration in seconds must be non-negative')
  .brand('DurationSeconds');
