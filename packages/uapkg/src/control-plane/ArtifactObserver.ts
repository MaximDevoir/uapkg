import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface ObservedArtifact {
  /** Exactly `sha256:` + 64 lowercase hex characters. */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Local path of the exact bytes that were hashed (source of claims). */
  readonly archivePath: string;
  /** Removes any temporary download; no-op for caller-provided archives. */
  cleanup(): Promise<void>;
}

async function hashFile(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const source = createReadStream(path);
  source.on('data', (chunk: string | Buffer) => {
    sizeBytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    hash.update(chunk);
  });
  await new Promise<void>((resolve, reject) => {
    source.on('end', resolve);
    source.on('error', reject);
  });
  return { sha256: `sha256:${hash.digest('hex')}`, sizeBytes };
}

/**
 * Produces the client-observed artifact facts for a publish submission:
 * the exact bytes are hashed and later read for packaged claims, so the
 * archive — not the working tree — is what gets published (archive wins).
 */
export class ArtifactObserver {
  /** Observes a caller-provided local archive without copying it. */
  public async observeLocalArchive(archivePath: string): Promise<ObservedArtifact> {
    const fileInfo = await stat(archivePath).catch(() => null);
    if (!fileInfo?.isFile()) {
      throw new Error(`The archive at "${archivePath}" does not exist or is not a file.`);
    }
    const digest = await hashFile(archivePath);
    return { ...digest, archivePath, cleanup: async () => {} };
  }

  /**
   * Downloads the named uploaded release asset over unauthenticated HTTPS
   * (redirects followed) and observes the received bytes.
   */
  public async downloadReleaseAsset(
    repository: string,
    releaseTag: string,
    assetName: string,
  ): Promise<ObservedArtifact> {
    const url = `https://github.com/${repository}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(assetName)}`;
    const tempDir = await mkdtemp(join(tmpdir(), 'uapkg-publish-'));
    const archivePath = join(tempDir, assetName);
    const cleanup = async (): Promise<void> => {
      await rm(tempDir, { recursive: true, force: true });
    };

    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok || !response.body) {
        throw new Error(
          `Unable to download the release asset (${response.status}). Confirm the GitHub Release "${releaseTag}" has an uploaded asset named "${assetName}" and that the repository is accessible without credentials.` +
            `\nSee how to set these options manually using \`uapkg publish --help\`.`,
        );
      }
      await pipeline(
        Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
        createWriteStream(archivePath),
      );
      const digest = await hashFile(archivePath);
      return { ...digest, archivePath, cleanup };
    } catch (error) {
      await cleanup();
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}
