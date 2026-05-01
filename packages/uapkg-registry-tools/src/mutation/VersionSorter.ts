import { rcompare } from 'semver';

/**
 * Sort registry version keys newest-first by SemVer.
 *
 * Invalid SemVer strings sort to the end in their original order so we never
 * silently drop them; validation elsewhere reports them as schema errors.
 */
export function sortVersionsNewestFirst(versions: readonly string[]): string[] {
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const v of versions) {
    if (isValidLooking(v)) valid.push(v);
    else invalid.push(v);
  }

  valid.sort((a, b) => safeRcompare(a, b));
  return [...valid, ...invalid];
}

function isValidLooking(v: string): boolean {
  return /^\d+\.\d+\.\d+/.test(v);
}

function safeRcompare(a: string, b: string): number {
  try {
    return rcompare(a, b);
  } catch {
    return 0;
  }
}
