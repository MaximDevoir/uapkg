import { z } from 'zod';
import {
  ControlPlaneError,
  type RegistryTrust,
  UAPKG_CONTROL_PLANE_API,
  UAPKG_GITHUB_OIDC_AUDIENCE,
} from './ControlPlaneTypes.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_STATUS_CODES = new Set([429, 503]);

const githubResponseSchema = z.strictObject({ value: z.string().min(1) });
const exchangeResponseSchema = z.strictObject({
  ok: z.literal(true),
  token: z.string().min(1),
  expiresAt: z.number().int().positive(),
});
const exchangeErrorSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export type GitHubActionsOidcErrorCode =
  | 'OIDC_CONTROL_PLANE_UNTRUSTED'
  | 'OIDC_GITHUB_CONTEXT_UNAVAILABLE'
  | 'OIDC_GITHUB_ENDPOINT_INVALID'
  | 'OIDC_GITHUB_TOKEN_REQUEST_FAILED'
  | 'OIDC_GITHUB_TOKEN_REQUEST_TIMEOUT'
  | 'OIDC_GITHUB_TOKEN_REJECTED'
  | 'OIDC_GITHUB_TOKEN_RESPONSE_INVALID'
  | 'OIDC_GITHUB_TOKEN_RESPONSE_TOO_LARGE'
  | 'OIDC_EXCHANGE_REQUEST_FAILED'
  | 'OIDC_EXCHANGE_REQUEST_TIMEOUT'
  | 'OIDC_EXCHANGE_REJECTED'
  | 'OIDC_EXCHANGE_RESPONSE_INVALID'
  | 'OIDC_EXCHANGE_RESPONSE_TOO_LARGE';

/** Stable local failures from the GitHub Actions OIDC credential flow. */
export class GitHubActionsOidcError extends Error {
  public constructor(
    public readonly code: GitHubActionsOidcErrorCode,
    message: string,
    public readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GitHubActionsOidcError';
  }
}

export interface GitHubActionsOidcCredentialProviderOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly requestTimeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly maxAttempts?: number;
  readonly maxRetryDelayMs?: number;
}

type OidcEndpoint = 'github' | 'exchange';

export class GitHubActionsOidcCredentialProvider {
  private readonly fetch: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly maxAttempts: number;
  private readonly maxRetryDelayMs: number;

  public constructor(options: GitHubActionsOidcCredentialProviderOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? delay;
    this.requestTimeoutMs = positiveInteger(options.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);
    this.maxResponseBytes = positiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES);
    this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.maxRetryDelayMs = positiveInteger(options.maxRetryDelayMs, DEFAULT_MAX_RETRY_DELAY_MS);
  }

  public isAvailable(): boolean {
    return Boolean(
      process.env.GITHUB_ACTIONS === 'true' ||
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL ||
        process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    );
  }

  public async exchange(trust: RegistryTrust): Promise<string> {
    if (trust.apiBaseUrl !== UAPKG_CONTROL_PLANE_API) {
      throw new GitHubActionsOidcError(
        'OIDC_CONTROL_PLANE_UNTRUSTED',
        `UAPKG v1 OIDC exchange is pinned to ${UAPKG_CONTROL_PLANE_API}.`,
      );
    }
    const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
    if (!this.isAvailable() || !requestUrl || !requestToken) {
      throw new GitHubActionsOidcError(
        'OIDC_GITHUB_CONTEXT_UNAVAILABLE',
        'GitHub Actions OIDC was selected but its identity-token endpoint is unavailable. The workflow must grant `id-token: write`.',
      );
    }

    const url = parseGitHubOidcEndpoint(requestUrl);
    url.searchParams.set('audience', UAPKG_GITHUB_OIDC_AUDIENCE);

    const githubResponse = await this.fetchWithRetry(
      url,
      {
        headers: { authorization: `Bearer ${requestToken}` },
      },
      'github',
    );
    const githubValue = githubResponseSchema.safeParse(await this.readJson(githubResponse, 'github'));
    if (!githubResponse.ok) {
      throw new GitHubActionsOidcError(
        'OIDC_GITHUB_TOKEN_REJECTED',
        `GitHub Actions did not issue an OIDC identity token (HTTP ${githubResponse.status}).`,
        githubResponse.status,
      );
    }
    if (!githubValue.success) {
      throw new GitHubActionsOidcError(
        'OIDC_GITHUB_TOKEN_RESPONSE_INVALID',
        'GitHub Actions returned an invalid OIDC identity-token response.',
        githubResponse.status,
      );
    }

    const exchangeResponse = await this.fetchWithRetry(
      new URL('/v1/github-user-app/oidc/github-actions/exchange', trust.apiBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          provider: 'github_actions',
          audience: UAPKG_GITHUB_OIDC_AUDIENCE,
          idToken: githubValue.data.value,
        }),
      },
      'exchange',
    );
    const exchangeValue = await this.readJson(exchangeResponse, 'exchange');
    if (!exchangeResponse.ok) {
      const error = exchangeErrorSchema.safeParse(exchangeValue);
      if (error.success) {
        throw new ControlPlaneError(
          error.data.error.code,
          error.data.error.message,
          exchangeResponse.status,
          error.data.error.details,
        );
      }
      throw new GitHubActionsOidcError(
        'OIDC_EXCHANGE_REJECTED',
        `UAPKG rejected the GitHub Actions identity (HTTP ${exchangeResponse.status}).`,
        exchangeResponse.status,
      );
    }
    const parsed = exchangeResponseSchema.safeParse(exchangeValue);
    if (!parsed.success) {
      throw new GitHubActionsOidcError(
        'OIDC_EXCHANGE_RESPONSE_INVALID',
        'The UAPKG OIDC exchange response was invalid.',
        exchangeResponse.status,
      );
    }
    return parsed.data.token;
  }

  private async fetchWithRetry(url: URL, init: RequestInit, endpoint: OidcEndpoint): Promise<Response> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetch(url, {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(this.requestTimeoutMs),
        });
      } catch (error) {
        if (attempt < this.maxAttempts) {
          await this.sleep(this.retryDelay(undefined, attempt));
          continue;
        }
        throw requestFailure(endpoint, error);
      }

      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === this.maxAttempts) return response;

      const retryAfter = response.headers.get('retry-after');
      await response.body?.cancel().catch(() => undefined);
      await this.sleep(this.retryDelay(retryAfter, attempt));
    }

    throw new Error('OIDC retry loop exhausted unexpectedly.');
  }

  private retryDelay(retryAfter: string | null | undefined, attempt: number): number {
    const parsed = parseRetryAfter(retryAfter);
    const fallback = DEFAULT_RETRY_DELAY_MS * 2 ** (attempt - 1);
    return Math.min(parsed ?? fallback, this.maxRetryDelayMs);
  }

  private async readJson(response: Response, endpoint: OidcEndpoint): Promise<unknown> {
    const contentLength = parseContentLength(response.headers.get('content-length'));
    if (contentLength !== undefined && contentLength > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw responseTooLarge(endpoint, response.status);
    }

    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          byteLength += value.byteLength;
          if (byteLength > this.maxResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw responseTooLarge(endpoint, response.status);
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }

    if (byteLength === 0) return {};
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
      throw responseInvalid(endpoint, response.status);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch (error) {
      throw responseInvalid(endpoint, response.status, error);
    }
  }
}

function parseGitHubOidcEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GitHubActionsOidcError(
      'OIDC_GITHUB_ENDPOINT_INVALID',
      'GitHub Actions supplied an unexpected OIDC token endpoint.',
      undefined,
      { cause: error },
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    (hostname !== 'actions.githubusercontent.com' && !hostname.endsWith('.actions.githubusercontent.com'))
  ) {
    throw new GitHubActionsOidcError(
      'OIDC_GITHUB_ENDPOINT_INVALID',
      'GitHub Actions supplied an unexpected OIDC token endpoint.',
    );
  }
  return url;
}

function requestFailure(endpoint: OidcEndpoint, error: unknown): GitHubActionsOidcError {
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  if (endpoint === 'github') {
    return new GitHubActionsOidcError(
      timedOut ? 'OIDC_GITHUB_TOKEN_REQUEST_TIMEOUT' : 'OIDC_GITHUB_TOKEN_REQUEST_FAILED',
      timedOut
        ? 'Timed out while requesting a GitHub Actions OIDC identity token.'
        : 'Unable to request a GitHub Actions OIDC identity token.',
      undefined,
      { cause: error },
    );
  }
  return new GitHubActionsOidcError(
    timedOut ? 'OIDC_EXCHANGE_REQUEST_TIMEOUT' : 'OIDC_EXCHANGE_REQUEST_FAILED',
    timedOut
      ? 'Timed out while exchanging the GitHub Actions identity with UAPKG.'
      : 'Unable to exchange the GitHub Actions identity with UAPKG.',
    undefined,
    { cause: error },
  );
}

function responseTooLarge(endpoint: OidcEndpoint, status: number): GitHubActionsOidcError {
  return endpoint === 'github'
    ? new GitHubActionsOidcError(
        'OIDC_GITHUB_TOKEN_RESPONSE_TOO_LARGE',
        'GitHub Actions returned an oversized OIDC identity-token response.',
        status,
      )
    : new GitHubActionsOidcError(
        'OIDC_EXCHANGE_RESPONSE_TOO_LARGE',
        'The UAPKG OIDC exchange returned an oversized response.',
        status,
      );
}

function responseInvalid(endpoint: OidcEndpoint, status: number, cause?: unknown): GitHubActionsOidcError {
  return endpoint === 'github'
    ? new GitHubActionsOidcError(
        'OIDC_GITHUB_TOKEN_RESPONSE_INVALID',
        'GitHub Actions returned an invalid OIDC identity-token response.',
        status,
        { cause },
      )
    : new GitHubActionsOidcError(
        'OIDC_EXCHANGE_RESPONSE_INVALID',
        'The UAPKG OIDC exchange response was invalid.',
        status,
        { cause },
      );
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : undefined;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
