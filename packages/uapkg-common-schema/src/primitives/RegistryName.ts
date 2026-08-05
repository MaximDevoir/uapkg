import { z } from 'zod';
import type { Brand } from '../brand/Brand.js';

/**
 * Branded type for a logical registry name (the key under `registries` in config).
 */
export type RegistryName = Brand<string, 'RegistryName'>;

export const RegistryNameSchema = z
  .string()
  .min(1, 'Registry name must not be empty')
  .transform((v) => v as RegistryName);

/**
 * The machine-local alias that resolves to the user's configured default
 * registry. In manifests and registry records the default is represented by
 * an ABSENT `registry` field; this alias exists only at local resolution
 * boundaries (config, CLI input) and an explicit `"default"` normalizes to
 * absence.
 */
export const DEFAULT_REGISTRY_ALIAS = 'default' as RegistryName;
