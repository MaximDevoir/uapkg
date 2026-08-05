import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify, parseJsonStrict, sha256OfCanonicalJson } from '../src/index.js';

describe('parseJsonStrict', () => {
  it('parses ordinary JSON', () => {
    const result = parseJsonStrict('{"a": 1, "b": [true, null, "x"]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ a: 1, b: [true, null, 'x'] });
  });

  it('rejects invalid JSON', () => {
    const result = parseJsonStrict('{nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_JSON_INVALID');
  });

  it('rejects duplicate sibling keys', () => {
    const result = parseJsonStrict('{"dependencies": {"foo": "^1.0.0", "foo": "^2.0.0"}}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_JSON_DUPLICATE_KEY');
  });

  it('allows equal keys in different objects', () => {
    const result = parseJsonStrict('{"a": {"x": 1}, "b": {"x": 2}}');
    expect(result.ok).toBe(true);
  });

  it('does not treat string values as keys', () => {
    const result = parseJsonStrict('{"a": "a", "b": ["a", "a"], "c": "b"}');
    expect(result.ok).toBe(true);
  });

  it('handles escaped quotes and braces inside strings', () => {
    const result = parseJsonStrict('{"a\\"{": 1, "b": "}{,\\""}');
    expect(result.ok).toBe(true);
  });
});

describe('canonicalJsonStringify', () => {
  it('sorts object keys and drops whitespace', () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(canonicalJsonStringify([2, 1, { b: 1, a: 2 }])).toBe('[2,1,{"a":2,"b":1}]');
  });

  it('omits undefined members', () => {
    expect(canonicalJsonStringify({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('sha256OfCanonicalJson', () => {
  it('is key-order independent', () => {
    expect(sha256OfCanonicalJson({ a: 1, b: 2 })).toBe(sha256OfCanonicalJson({ b: 2, a: 1 }));
  });

  it('changes when shared content changes', () => {
    expect(sha256OfCanonicalJson({ a: 1 })).not.toBe(sha256OfCanonicalJson({ a: 2 }));
  });
});
