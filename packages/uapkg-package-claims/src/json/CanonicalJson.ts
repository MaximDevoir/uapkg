import { createHash } from 'node:crypto';
import { DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';

/**
 * Parse JSON while rejecting duplicate object keys, which `JSON.parse`
 * silently collapses (last key wins). Duplicate keys in a packaged manifest
 * could otherwise smuggle a second value past comparison.
 */
export function parseJsonStrict(text: string, sourceLabel = 'json'): Result<unknown> {
  const bag = new DiagnosticBag();

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    bag.addError(
      'CLAIMS_JSON_INVALID',
      `Failed to parse ${sourceLabel}: ${err instanceof Error ? err.message : String(err)}`,
      {
        source: sourceLabel,
      },
    );
    return bag.toFailure();
  }

  const duplicate = findDuplicateKey(text);
  if (duplicate !== null) {
    bag.addError('CLAIMS_JSON_DUPLICATE_KEY', `Duplicate JSON key "${duplicate}" in ${sourceLabel}`, {
      source: sourceLabel,
      key: duplicate,
    });
    return bag.toFailure();
  }

  return ok(value);
}

/**
 * Scan already-valid JSON text for duplicate sibling object keys.
 * Returns the first duplicate key found, or null.
 */
function findDuplicateKey(text: string): string | null {
  type Frame = { kind: 'object'; keys: Set<string>; expectingKey: boolean } | { kind: 'array' };
  const stack: Frame[] = [];
  let i = 0;

  const readString = (): string => {
    // text[i] === '"'; JSON validity is already established by JSON.parse.
    const start = i;
    i += 1;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') {
        i += 1;
        return JSON.parse(text.slice(start, i)) as string;
      }
      i += 1;
    }
    return JSON.parse(text.slice(start)) as string;
  };

  while (i < text.length) {
    const ch = text[i];
    const top = stack[stack.length - 1];

    if (ch === '"') {
      const isKey = top?.kind === 'object' && top.expectingKey;
      const value = readString();
      if (isKey && top.kind === 'object') {
        if (top.keys.has(value)) return value;
        top.keys.add(value);
        top.expectingKey = false;
      }
      continue;
    }

    if (ch === '{') {
      stack.push({ kind: 'object', keys: new Set(), expectingKey: true });
    } else if (ch === '}') {
      stack.pop();
    } else if (ch === '[') {
      stack.push({ kind: 'array' });
    } else if (ch === ']') {
      stack.pop();
    } else if (ch === ',' && top?.kind === 'object') {
      top.expectingKey = true;
    }
    i += 1;
  }

  return null;
}

/**
 * Deterministic canonical JSON: object keys sorted lexicographically,
 * no insignificant whitespace, `undefined` members omitted.
 */
export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonStringify(entry === undefined ? null : entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    const members = keys.map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(record[key])}`);
    return `{${members.join(',')}}`;
  }
  throw new TypeError(`Cannot canonicalize value of type ${typeof value}`);
}

/** SHA-256 (lowercase hex) of the canonical JSON encoding of `value`. */
export function sha256OfCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex');
}
