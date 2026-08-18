import type { $brand } from 'zod';

/**
 * Nominal (branded) type utility.
 *
 * Uses Zod's type-only brand so runtime schemas remain their native JSON
 * Schema-compatible primitive type while structurally identical values stay
 * incompatible at compile time.
 *
 * @example
 * type PackageName = Brand<string, 'PackageName'>;
 */
export type Brand<T, B extends string> = T & $brand<B>;
