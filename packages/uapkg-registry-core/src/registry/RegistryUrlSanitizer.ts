const REDACTED = '<redacted>';

/** Return a registry coordinate that is safe to include in diagnostics. */
export function sanitizeRegistryUrlForDisplay(registryUrl: string): string {
  try {
    const parsed = new URL(registryUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    }
  } catch {
    // A malformed legacy HTTP URL must fail closed because it may still
    // contain credentials even though the URL parser rejected it.
    if (isHttpCoordinate(registryUrl)) return '<registry-url>';
  }

  return registryUrl;
}

/**
 * Remove a registry URL and any HTTP credential/query/fragment material from
 * arbitrary Git output before it enters a diagnostic.
 */
export function redactRegistryUrlSecrets(value: string, registryUrl: string): string {
  const safeUrl = sanitizeRegistryUrlForDisplay(registryUrl);
  let redacted = replaceLiteral(value, registryUrl, safeUrl);
  const secrets = collectRawHttpSecrets(registryUrl);

  try {
    const parsed = new URL(registryUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return redacted;

    addSecret(secrets, parsed.username);
    addSecret(secrets, parsed.password);
    addSecret(secrets, parsed.search.slice(1));
    addSecret(secrets, parsed.hash.slice(1));
    for (const [key, queryValue] of parsed.searchParams) {
      addSecret(secrets, key);
      addSecret(secrets, queryValue);
      addSecret(secrets, `${key}=${queryValue}`);
    }
  } catch {
    // Raw extraction above also covers malformed legacy HTTP URLs.
  }

  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    redacted = replaceLiteral(redacted, secret, REDACTED);
    try {
      redacted = replaceLiteral(redacted, decodeURIComponent(secret), REDACTED);
    } catch {
      // Malformed percent-encoding is left covered by the raw replacement.
    }
  }

  return redacted;
}

function collectRawHttpSecrets(registryUrl: string): Set<string> {
  const secrets = new Set<string>();
  if (!isHttpCoordinate(registryUrl)) return secrets;

  const schemeEnd = registryUrl.indexOf('://') + 3;
  const authorityEnd = findFirstIndex(registryUrl, schemeEnd, ['/', '?', '#']);
  const authority = registryUrl.slice(schemeEnd, authorityEnd);
  const at = authority.lastIndexOf('@');
  if (at >= 0) {
    const userInfo = authority.slice(0, at);
    addSecret(secrets, userInfo);
    for (const part of userInfo.split(':')) addSecret(secrets, part);
  }

  const queryStart = registryUrl.indexOf('?', schemeEnd);
  const fragmentStart = registryUrl.indexOf('#', schemeEnd);
  if (queryStart >= 0) {
    const queryEnd = fragmentStart > queryStart ? fragmentStart : registryUrl.length;
    const query = registryUrl.slice(queryStart + 1, queryEnd);
    addSecret(secrets, query);
    for (const pair of query.split('&')) {
      addSecret(secrets, pair);
      for (const part of pair.split('=')) addSecret(secrets, part);
    }
  }
  if (fragmentStart >= 0) addSecret(secrets, registryUrl.slice(fragmentStart + 1));
  return secrets;
}

function findFirstIndex(value: string, start: number, candidates: readonly string[]): number {
  const indexes = candidates.map((candidate) => value.indexOf(candidate, start)).filter((index) => index >= 0);
  return indexes.length === 0 ? value.length : Math.min(...indexes);
}

function isHttpCoordinate(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function addSecret(secrets: Set<string>, value: string): void {
  if (value.length > 0) secrets.add(value);
}

function replaceLiteral(value: string, search: string, replacement: string): string {
  return search.length === 0 ? value : value.replaceAll(search, replacement);
}
