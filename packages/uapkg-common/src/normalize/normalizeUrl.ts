/**
 * Normalize a registry URL for identity hashing.
 *
 * GitHub repository coordinates are normalized across HTTPS, SSH URL, and
 * SCP-like syntax. Generic URL paths retain their case because not every Git
 * host treats paths as case-insensitive.
 */
export function normalizeUrl(url: string): string {
  const value = url.trim();
  if (/^[a-z]:[\\/]/i.test(value)) {
    return normalizeRepositoryPath(value);
  }
  const scpLike = parseScpLikeUrl(value);

  if (scpLike) {
    const host = scpLike.host.toLowerCase();
    const path = normalizeRepositoryPath(scpLike.path);

    if (isGitHubHost(host)) {
      return normalizeGitHubRepository(path);
    }

    return `ssh://${host}/${path}`;
  }

  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    removeDefaultPort(parsed);

    let path = normalizeRepositoryPath(parsed.pathname);
    if (isGitHubHost(parsed.hostname)) {
      path = normalizeGitHubRepositoryPath(path);
      if (parsed.port.length === 0) {
        return `https://github.com/${path}`;
      }
    }

    parsed.pathname = path.length > 0 ? `/${path}` : '';
    return serializeWithoutTrailingSeparator(parsed);
  } catch {
    // Local and relative Git paths can be case-sensitive. Only strip the
    // transport-independent repository suffixes for values without a host.
    return normalizeRepositoryPath(value);
  }
}

interface ScpLikeUrl {
  readonly host: string;
  readonly path: string;
}

function parseScpLikeUrl(value: string): ScpLikeUrl | null {
  // Do not confuse a Windows drive path with SCP-like `host:path` syntax.
  if (/^[a-z]:[\\/]/i.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;

  const match = value.match(/^(?:[^@\s/:]+@)?(\[[^\]]+\]|[^:/\s]+):(.+)$/);
  if (!match?.[1] || !match[2]) return null;
  return { host: match[1], path: match[2] };
}

function normalizeRepositoryPath(path: string): string {
  return path
    .replace(/^[/\\]+/, '')
    .replace(/[/\\]+$/, '')
    .replace(/\.git$/i, '');
}

function isGitHubHost(host: string): boolean {
  return host.toLowerCase() === 'github.com';
}

function normalizeGitHubRepository(path: string): string {
  return `https://github.com/${normalizeGitHubRepositoryPath(path)}`;
}

function normalizeGitHubRepositoryPath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  const normalizedSegments = segments.map((segment, index) => (index < 2 ? segment.toLowerCase() : segment));
  return normalizedSegments.join('/');
}

function removeDefaultPort(url: URL): void {
  const defaultPorts: Readonly<Record<string, string>> = {
    'http:': '80',
    'https:': '443',
    'ssh:': '22',
    'git:': '9418',
  };
  if (url.port === defaultPorts[url.protocol]) {
    url.port = '';
  }
}

function serializeWithoutTrailingSeparator(url: URL): string {
  const suffix = `${url.search}${url.hash}`;
  const serialized = url.toString();
  const base = suffix.length > 0 ? serialized.slice(0, -suffix.length) : serialized;
  return `${base.replace(/\/+$/, '')}${suffix}`;
}
