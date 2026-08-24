import { readFile, unlink } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { PackageDownloader } from '../src/core/PackageDownloader.ts';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

const downloader = new PackageDownloader();
const servers: Server[] = [];
const downloadedPaths: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    downloadedPaths.splice(0).map(async (path) => {
      try {
        await unlink(path);
      } catch {
        /* best-effort test cleanup */
      }
    }),
  );
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function startServer(handler: RequestHandler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function downloadBytes(
  url: string,
  options: { readonly retries: number; readonly timeoutMs: number } = {
    retries: 0,
    timeoutMs: 5_000,
  },
): Promise<Buffer> {
  const result = await downloader.download('test-package', url, options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  downloadedPaths.push(result.value.tempPath);
  return readFile(result.value.tempPath);
}

describe('PackageDownloader', () => {
  it('downloads a direct 2xx response and reports byte progress without credentials', async () => {
    const body = Buffer.from('direct artifact');
    let authorization: string | undefined;
    let cookie: string | undefined;
    const baseUrl = await startServer((request, response) => {
      authorization = request.headers.authorization;
      cookie = request.headers.cookie;
      response.statusCode = 200;
      response.setHeader('content-length', body.length);
      response.end(body);
    });
    const progress: Array<{ done: number; total: number | undefined; attempt: number }> = [];

    const result = await downloader.download(
      'test-package',
      `${baseUrl}/artifact.tgz`,
      { retries: 0, timeoutMs: 5_000 },
      (done, total, attempt) => progress.push({ done, total, attempt }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    downloadedPaths.push(result.value.tempPath);
    expect(await readFile(result.value.tempPath)).toEqual(body);
    expect(result.value).toMatchObject({ bytesDownloaded: body.length, bytesTotal: body.length });
    expect(progress.at(-1)).toEqual({ done: body.length, total: body.length, attempt: 1 });
    expect(authorization).toBeUndefined();
    expect(cookie).toBeUndefined();
  });

  it('does not treat an encoded transfer length as the decoded artifact size', async () => {
    const body = Buffer.from('decoded artifact bytes '.repeat(20));
    const encodedBody = gzipSync(body);
    const baseUrl = await startServer((_request, response) => {
      response.statusCode = 200;
      response.setHeader('content-encoding', 'gzip');
      response.setHeader('content-length', encodedBody.length);
      response.end(encodedBody);
    });
    const progress: Array<{ done: number; total: number | undefined }> = [];

    const result = await downloader.download(
      'test-package',
      `${baseUrl}/encoded.tgz`,
      { retries: 0, timeoutMs: 5_000 },
      (done, total) => progress.push({ done, total }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    downloadedPaths.push(result.value.tempPath);
    expect(await readFile(result.value.tempPath)).toEqual(body);
    expect(result.value.bytesDownloaded).toBe(body.length);
    expect(result.value.bytesTotal).toBeUndefined();
    expect(progress.at(-1)).toEqual({ done: body.length, total: undefined });
  });

  it('follows relative and cross-origin redirects', async () => {
    const body = Buffer.from('redirected artifact');
    const targetBaseUrl = await startServer((request, response) => {
      expect(request.url).toBe('/download.tgz');
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      response.statusCode = 200;
      response.end(body);
    });
    const sourceBaseUrl = await startServer((request, response) => {
      expect(request.headers.authorization).toBeUndefined();
      expect(request.headers.cookie).toBeUndefined();
      response.statusCode = 302;
      response.setHeader('location', request.url === '/start' ? '/middle' : `${targetBaseUrl}/download.tgz`);
      response.end('redirecting');
    });

    await expect(downloadBytes(`${sourceBaseUrl}/start`)).resolves.toEqual(body);
  });

  it('allows exactly five redirects and rejects a sixth', async () => {
    const body = Buffer.from('redirect boundary');
    const requestCounts = new Map<string, number>();
    const baseUrl = await startServer((request, response) => {
      const path = request.url ?? '/';
      requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
      const match = /^\/(ok|too)\/(\d+)$/.exec(path);
      if (!match) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const step = Number(match[2]);
      const terminalStep = match[1] === 'ok' ? 5 : 6;
      if (step < terminalStep) {
        response.statusCode = 302;
        response.setHeader('location', `/${match[1]}/${step + 1}`);
        response.end();
        return;
      }
      response.statusCode = 200;
      response.end(body);
    });

    await expect(downloadBytes(`${baseUrl}/ok/0`)).resolves.toEqual(body);

    const rejected = await downloader.download('test-package', `${baseUrl}/too/0`, {
      retries: 0,
      timeoutMs: 5_000,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DOWNLOAD_FAILED',
      'NETWORK_RETRIES_EXHAUSTED',
    ]);
    expect(rejected.diagnostics[0]?.message).toContain('redirect limit of 5 exceeded');
    expect(requestCounts.get('/too/6')).toBeUndefined();
  });

  it('detects redirect loops', async () => {
    let requests = 0;
    const baseUrl = await startServer((request, response) => {
      requests++;
      response.statusCode = 302;
      response.setHeader('location', request.url === '/a' ? '/b' : '/a');
      response.end();
    });

    const result = await downloader.download('test-package', `${baseUrl}/a`, {
      retries: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain('redirect loop detected');
    expect(requests).toBe(2);
  });

  it.each([
    ['missing location', undefined, 'missing a Location header'],
    ['invalid location', 'http://[', 'invalid Location header'],
    ['unsupported scheme', 'file:///tmp/package.tgz', 'scheme "file:" is not supported'],
    ['credential-bearing target', 'https://user:secret@example.test/package.tgz', 'must not contain credentials'],
  ])('rejects a %s redirect', async (_label, location, expectedReason) => {
    const responseHeaders = location === undefined ? undefined : { location };
    const fetchMock = vi.fn(async () => new Response('redirect', { status: 302, headers: responseHeaders }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/start', {
      retries: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain(expectedReason);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported and credential-bearing initial URLs before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    for (const url of ['file:///tmp/package.tgz', 'http://user:secret@example.test/package.tgz']) {
      const result = await downloader.download('test-package', url, {
        retries: 2,
        timeoutMs: 5_000,
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        'DOWNLOAD_FAILED',
        'NETWORK_RETRIES_EXHAUSTED',
      ]);
      expect(JSON.stringify(result.diagnostics)).not.toContain('secret');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an HTTPS-to-HTTP redirect', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://example.test/package.tgz' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/start', {
      retries: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain('cannot redirect to HTTP');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([304, 400, 404])('rejects terminal HTTP %i after the configured retries', async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/package.tgz', {
      retries: 2,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DOWNLOAD_HTTP_STATUS',
      'NETWORK_RETRIES_EXHAUSTED',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries HTTP 5xx responses and reports exhausted retries', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/package.tgz', {
      retries: 2,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'DOWNLOAD_HTTP_STATUS',
      'NETWORK_RETRIES_EXHAUSTED',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires a response body even for a successful HTTP status', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/package.tgz', {
      retries: 2,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0]?.message).toContain('response body is missing');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries network errors while preserving the successful attempt number in progress', async () => {
    const body = Buffer.from('eventual artifact');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }));
    vi.stubGlobal('fetch', fetchMock);
    const attempts: number[] = [];

    const result = await downloader.download(
      'test-package',
      'https://example.test/package.tgz',
      { retries: 1, timeoutMs: 5_000 },
      (_done, _total, attempt) => attempts.push(attempt),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    downloadedPaths.push(result.value.tempPath);
    expect(await readFile(result.value.tempPath)).toEqual(body);
    expect(attempts).toEqual([2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts a timed-out transfer and reports the configured timeout', async () => {
    let aborted = false;
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted transport'));
          });
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await downloader.download('test-package', 'https://example.test/package.tgz', {
      retries: 0,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(aborted).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'NETWORK_TIMEOUT',
      'NETWORK_RETRIES_EXHAUSTED',
    ]);
  });

  it('uses GitHub asset media headers only for the strict legacy API URL and follows its redirect', async () => {
    const body = Buffer.from('legacy GitHub artifact');
    const redirectResponse = new Response('{"browser_download_url":"not parsed"}', {
      status: 302,
      headers: { location: 'https://objects.githubusercontent.com/release-assets/package.tgz' },
    });
    const redirectBody = redirectResponse.body;
    if (!redirectBody) throw new Error('redirect fixture requires a response body');
    const cancelSpy = vi.spyOn(redirectBody, 'cancel');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadBytes('https://api.github.com/repos/maximdevoir/example/releases/assets/466157977'),
    ).resolves.toEqual(body);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const firstHeaders = new Headers(firstInit.headers);
    expect(firstInit).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'omit' });
    expect(firstHeaders.get('accept')).toBe('application/octet-stream');
    expect(firstHeaders.get('user-agent')).toBe('uapkg-installer');
    expect(firstHeaders.get('x-github-api-version')).toBe('2026-03-10');
    expect(firstHeaders.get('authorization')).toBeNull();
    expect(firstHeaders.get('cookie')).toBeNull();

    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const secondHeaders = new Headers(secondInit.headers);
    expect(secondHeaders.get('accept')).toBeNull();
    expect(secondHeaders.get('user-agent')).toBeNull();
    expect(secondHeaders.get('x-github-api-version')).toBeNull();
    expect(secondHeaders.get('authorization')).toBeNull();
    expect(secondHeaders.get('cookie')).toBeNull();
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it('does not apply GitHub media headers to lookalike API URLs', async () => {
    const body = Buffer.from('ordinary response');
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(new Response(body, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      downloadBytes('https://api.github.com/repos/maximdevoir/example/releases/assets/466157977?download=1'),
    ).resolves.toEqual(body);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toBeUndefined();
  });

  it('never exposes a signed redirect target in HTTP diagnostics', async () => {
    const signedTarget = 'https://objects.githubusercontent.com/package.tgz?jwt=super-secret-value';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: signedTarget } }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const originalUrl = 'https://github.com/example/project/releases/download/v1/package.tgz';

    const result = await downloader.download('test-package', originalUrl, {
      retries: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(JSON.stringify(result.diagnostics)).toContain(originalUrl);
    expect(JSON.stringify(result.diagnostics)).not.toContain('super-secret-value');
  });

  it('strips an initial URL query and fragment from diagnostics', async () => {
    const fetchMock = vi.fn(async () => new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const safeUrl = 'https://github.com/example/project/releases/download/v1/package.tgz';
    const signedUrl = `${safeUrl}?jwt=initial-secret-value#private-fragment`;

    const result = await downloader.download('test-package', signedUrl, {
      retries: 0,
      timeoutMs: 5_000,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const serialized = JSON.stringify(result.diagnostics);
    expect(serialized).toContain(safeUrl);
    expect(serialized).not.toContain('initial-secret-value');
    expect(serialized).not.toContain('private-fragment');
  });
});
