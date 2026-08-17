import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createDownloadFailedDiagnostic,
  createDownloadHttpStatusDiagnostic,
  createNetworkRetriesExhaustedDiagnostic,
  createNetworkTimeoutDiagnostic,
  DiagnosticBag,
  ok,
  type Result,
} from '@uapkg/diagnostics';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const GITHUB_API_VERSION = '2026-03-10';
const GITHUB_ASSET_API_PATH =
  /^\/repos\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}\/releases\/assets\/[1-9]\d*$/;

class DownloadPolicyError extends Error {}

interface FollowedResponse {
  readonly response: Response;
}

/**
 * Progress callback fired on every received chunk.
 */
export type DownloadProgress = (bytesDone: number, bytesTotal: number | undefined, attempt: number) => void;

export interface DownloadOptions {
  readonly retries: number;
  readonly timeoutMs: number;
}

export interface DownloadResult {
  readonly tempPath: string;
  readonly bytesTotal?: number;
  /** Exact number of bytes written to the temp file. */
  readonly bytesDownloaded: number;
}

/**
 * Streams a .tgz from an HTTP(S) URL to a temp file with retry/timeout support.
 *
 * Retry behavior: any failed attempt is retried up to `retries` times, matching
 * the installer's established network retry contract.
 *
 * Does not throw — all errors converted to typed diagnostics.
 */
export class PackageDownloader {
  async download(
    packageName: string,
    url: string,
    options: DownloadOptions,
    onProgress?: DownloadProgress,
  ): Promise<Result<DownloadResult>> {
    const bag = new DiagnosticBag();
    const attempts = Math.max(1, options.retries + 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const attemptResult = await this.attempt(packageName, url, options, attempt, onProgress);
      if (attemptResult.ok) return attemptResult;

      // Final attempt — surface accumulated diagnostics plus "retries exhausted".
      if (attempt === attempts) {
        bag.mergeArray(attemptResult.diagnostics);
        bag.add(createNetworkRetriesExhaustedDiagnostic(packageName, this.diagnosticUrl(url), attempts));
        return bag.toFailure();
      }
      // Otherwise try again; transient diagnostics not surfaced (noisy).
    }

    return bag.toFailure();
  }

  private async attempt(
    packageName: string,
    url: string,
    options: DownloadOptions,
    attempt: number,
    onProgress?: DownloadProgress,
  ): Promise<Result<DownloadResult>> {
    const bag = new DiagnosticBag();
    const tempPath = await this.makeTempPath(packageName);
    const diagnosticUrl = this.diagnosticUrl(url);

    let timedOut = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    try {
      const { response } = await this.fetchFollowingRedirects(url, controller.signal);

      if (response.status < 200 || response.status >= 300) {
        await this.cancelResponseBody(response);
        await this.safeUnlink(tempPath);
        bag.add(createDownloadHttpStatusDiagnostic(packageName, diagnosticUrl, response.status));
        return bag.toFailure();
      }

      if (!response.body) {
        await this.safeUnlink(tempPath);
        bag.add(createDownloadFailedDiagnostic(packageName, diagnosticUrl, 'response body is missing', attempt));
        return bag.toFailure();
      }

      const contentEncoding = response.headers.get('content-encoding');
      const reportsDecodedLength = contentEncoding === null || contentEncoding.trim().toLowerCase() === 'identity';
      const totalHeader = reportsDecodedLength ? response.headers.get('content-length') : null;
      const parsedTotal = totalHeader !== null && /^\d+$/.test(totalHeader) ? Number(totalHeader) : undefined;
      const bytesTotal = parsedTotal !== undefined && Number.isSafeInteger(parsedTotal) ? parsedTotal : undefined;
      let bytesDone = 0;

      const progressStream = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytesDone += chunk.length;
          onProgress?.(bytesDone, bytesTotal, attempt);
          callback(null, chunk);
        },
      });

      await pipeline(Readable.fromWeb(response.body), progressStream, createWriteStream(tempPath));

      return ok({ tempPath, bytesTotal, bytesDownloaded: bytesDone });
    } catch (err) {
      await this.safeUnlink(tempPath);
      if (timedOut) {
        bag.add(createNetworkTimeoutDiagnostic(packageName, diagnosticUrl, Math.round(options.timeoutMs / 1000)));
      } else {
        bag.add(createDownloadFailedDiagnostic(packageName, diagnosticUrl, this.errorMessage(err), attempt));
      }
      return bag.toFailure();
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchFollowingRedirects(rawUrl: string, signal: AbortSignal): Promise<FollowedResponse> {
    let current = this.parseInitialUrl(rawUrl);
    const allowHttp = current.protocol === 'http:';
    const visited = new Set<string>();

    for (let redirects = 0; ; redirects++) {
      this.assertAllowedUrl(current, allowHttp);
      const requestUrl = new URL(current);
      requestUrl.hash = '';
      const requestKey = requestUrl.href;
      if (visited.has(requestKey)) {
        throw new DownloadPolicyError('redirect loop detected');
      }
      visited.add(requestKey);

      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: 'GET',
          redirect: 'manual',
          credentials: 'omit',
          headers: this.headersFor(requestUrl),
          signal,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        throw new Error('network request failed');
      }

      if (!REDIRECT_STATUSES.has(response.status)) {
        return { response };
      }

      if (redirects >= MAX_REDIRECTS) {
        await this.cancelResponseBody(response);
        throw new DownloadPolicyError(`redirect limit of ${MAX_REDIRECTS} exceeded`);
      }

      const location = response.headers.get('location');
      if (!location) {
        await this.cancelResponseBody(response);
        throw new DownloadPolicyError(`HTTP ${response.status} redirect is missing a Location header`);
      }

      let next: URL;
      try {
        next = new URL(location, requestUrl);
      } catch {
        await this.cancelResponseBody(response);
        throw new DownloadPolicyError(`HTTP ${response.status} redirect has an invalid Location header`);
      }

      try {
        this.assertAllowedUrl(next, allowHttp);
      } catch (err) {
        await this.cancelResponseBody(response);
        throw err;
      }
      await this.cancelResponseBody(response);
      current = next;
    }
  }

  private parseInitialUrl(rawUrl: string): URL {
    try {
      const parsed = new URL(rawUrl);
      this.assertAllowedUrl(parsed, parsed.protocol === 'http:');
      return parsed;
    } catch (err) {
      if (err instanceof DownloadPolicyError) throw err;
      throw new DownloadPolicyError('artifact URL is invalid');
    }
  }

  private assertAllowedUrl(url: URL, allowHttp: boolean): void {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new DownloadPolicyError(`artifact URL scheme "${url.protocol}" is not supported`);
    }
    if (url.protocol === 'http:' && !allowHttp) {
      throw new DownloadPolicyError('HTTPS artifact URL cannot redirect to HTTP');
    }
    if (url.username || url.password) {
      throw new DownloadPolicyError('artifact URL must not contain credentials');
    }
  }

  private headersFor(url: URL): Record<string, string> | undefined {
    if (!this.isLegacyGitHubAssetApiUrl(url)) return undefined;
    return {
      Accept: 'application/octet-stream',
      'User-Agent': 'uapkg-installer',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    };
  }

  private isLegacyGitHubAssetApiUrl(url: URL): boolean {
    return (
      url.protocol === 'https:' &&
      url.hostname === 'api.github.com' &&
      url.port === '' &&
      url.username === '' &&
      url.password === '' &&
      url.search === '' &&
      url.hash === '' &&
      GITHUB_ASSET_API_PATH.test(url.pathname)
    );
  }

  private async cancelResponseBody(response: Response): Promise<void> {
    try {
      await response.body?.cancel();
    } catch {
      /* best-effort */
    }
  }

  private errorMessage(err: unknown): string {
    return err instanceof DownloadPolicyError ? err.message : 'network or file transfer failed';
  }

  private diagnosticUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.username || parsed.password || parsed.search || parsed.hash) {
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.href;
      }
      return rawUrl;
    } catch {
      return '[invalid artifact URL]';
    }
  }

  private async makeTempPath(packageName: string): Promise<string> {
    const dir = join(tmpdir(), 'uapkg-installer');
    await mkdir(dir, { recursive: true });
    const safe = packageName.replace(/[^a-z0-9-_]/gi, '_');
    return join(dir, `${safe}-${Date.now()}-${Math.random().toString(36).slice(2)}.tgz`);
  }

  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch {
      /* best-effort */
    }
  }
}
