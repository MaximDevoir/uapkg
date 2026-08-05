import { DiagnosticBag, ok, type Result } from '@uapkg/diagnostics';
import { t as listTar } from 'tar';
import { normalizePackageClaims, type PackageClaims } from '../claims/PackageClaims.js';
import { parseJsonStrict } from '../json/CanonicalJson.js';

/** Raw packaged manifest read out of an artifact archive. */
export interface PackagedManifest {
  /** Archive-internal path of the manifest entry. */
  readonly entryPath: string;
  /** Raw UTF-8 manifest text. */
  readonly raw: string;
  /** Parsed JSON value (duplicate keys rejected). */
  readonly value: unknown;
}

export interface ReadPackagedManifestOptions {
  /** Upper bound for the manifest entry size. Default 1 MiB. */
  readonly maxManifestBytes?: number;
}

const DEFAULT_MAX_MANIFEST_BYTES = 1024 * 1024;

function isManifestEntryPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/^\.\//, '');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 1) return segments[0] === 'uapkg.json';
  // `uapkg pack` writes a `${name}-${version}/` prefix (installers extract with strip 1).
  if (segments.length === 2) return segments[1] === 'uapkg.json';
  return false;
}

/**
 * Read the packaged `uapkg.json` out of a `.tgz` artifact without extracting
 * it to disk. The packaged manifest is the artifact's identity authority.
 */
export async function readPackagedManifest(
  archivePath: string,
  options: ReadPackagedManifestOptions = {},
): Promise<Result<PackagedManifest>> {
  const bag = new DiagnosticBag();
  const maxBytes = options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES;

  const matches: { path: string; content: Buffer }[] = [];
  let oversizedEntry: string | null = null;

  try {
    await listTar({
      file: archivePath,
      onReadEntry: (entry) => {
        if (entry.type !== 'File' || !isManifestEntryPath(entry.path)) return;
        if (entry.size > maxBytes) {
          oversizedEntry = entry.path;
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        entry.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            oversizedEntry = entry.path;
            return;
          }
          chunks.push(chunk);
        });
        entry.on('end', () => {
          if (oversizedEntry !== entry.path) {
            matches.push({ path: entry.path, content: Buffer.concat(chunks) });
          }
        });
      },
    });
  } catch (err) {
    bag.addError(
      'CLAIMS_ARCHIVE_READ_ERROR',
      `Failed to read archive ${archivePath}: ${err instanceof Error ? err.message : err}`,
      { archivePath, reason: String(err) },
    );
    return bag.toFailure();
  }

  if (oversizedEntry !== null) {
    bag.addError('CLAIMS_MANIFEST_TOO_LARGE', `Packaged manifest ${oversizedEntry} exceeds ${maxBytes} bytes`, {
      archivePath,
      entryPath: oversizedEntry,
      maxBytes,
    });
    return bag.toFailure();
  }

  if (matches.length === 0) {
    bag.addError('CLAIMS_MANIFEST_MISSING', `Archive ${archivePath} contains no packaged uapkg.json`, {
      archivePath,
    });
    return bag.toFailure();
  }

  if (matches.length > 1) {
    bag.addError('CLAIMS_MANIFEST_AMBIGUOUS', `Archive ${archivePath} contains multiple candidate manifests`, {
      archivePath,
      entryPaths: matches.map((match) => match.path),
    });
    return bag.toFailure();
  }

  const raw = matches[0].content.toString('utf8');
  const parsed = parseJsonStrict(raw, matches[0].path);
  if (!parsed.ok) return parsed as Result<never>;

  return ok({ entryPath: matches[0].path, raw, value: parsed.value });
}

/**
 * Convenience: read the packaged manifest and normalize publication claims.
 */
export async function readPackageClaimsFromArchive(
  archivePath: string,
  options: ReadPackagedManifestOptions = {},
): Promise<Result<PackageClaims>> {
  const manifest = await readPackagedManifest(archivePath, options);
  if (!manifest.ok) return manifest as Result<never>;
  return normalizePackageClaims(manifest.value.value);
}
