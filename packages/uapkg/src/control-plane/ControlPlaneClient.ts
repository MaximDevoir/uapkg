import { randomUUID } from 'node:crypto';
import * as oauth from 'oauth4webapi';
import { z } from 'zod';
import {
  type AccountSelf,
  ControlPlaneError,
  type RegistryRequestStatus,
  type RegistryRequestSubmission,
  type RegistryRequestSummary,
  UAPKG_CONTROL_PLANE_API,
} from './ControlPlaneTypes.js';

export type ControlPlaneCredential =
  | {
      readonly kind: 'dpop';
      readonly accessToken: string;
      readonly dpop: oauth.DPoPHandle;
    }
  | {
      readonly kind: 'bearer';
      readonly accessToken: string;
    };

const errorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const accountSchema = z.object({
  id: z.string().min(1),
  username: z.string().optional(),
  displayName: z.string().optional(),
  email: z.string().optional(),
});

const accountResponseSchema = z.object({
  ok: z.literal(true),
  account: accountSchema,
  registry: z.object({
    id: z.uuid(),
  }),
  grant: z.object({
    id: z.uuid(),
    deviceName: z.string().min(1),
    idleExpiresAt: z.iso.datetime(),
    absoluteExpiresAt: z.iso.datetime(),
    scopes: z.array(z.string()),
  }),
});

const requestStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_for_pr_checks',
  'accepted',
  'failed',
  'timed_out',
  'finalization_failed',
]);

const requestSummarySchema = z
  .object({
    id: z.string().min(1),
    registryId: z.string().min(1),
    kind: z.string().min(1),
    status: requestStatusSchema,
    currentStep: z.string().optional(),
    createdAt: z.number().optional(),
    updatedAt: z.number().optional(),
    payload: z
      .object({
        packageName: z.string().optional(),
        packageVersion: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export class ControlPlaneClient {
  private readonly apiBaseUrl: string;

  public constructor(apiBaseUrl = UAPKG_CONTROL_PLANE_API) {
    const normalized = new URL(apiBaseUrl).href.replace(/\/+$/, '');
    if (normalized !== UAPKG_CONTROL_PLANE_API) {
      throw new Error(`UAPKG v1 control-plane requests are pinned to ${UAPKG_CONTROL_PLANE_API}.`);
    }
    this.apiBaseUrl = normalized;
  }

  public async getSelf(credential: ControlPlaneCredential, signal?: AbortSignal): Promise<AccountSelf> {
    const value = await this.requestJson(credential, 'GET', '/v1/account/self', { signal });
    const parsed = accountResponseSchema.safeParse(value);
    if (!parsed.success) {
      throw new ControlPlaneError('ACCOUNT_SELF_RESPONSE_INVALID', 'The account identity response was invalid.');
    }
    return {
      account: parsed.data.account,
      registry: parsed.data.registry,
      grant: parsed.data.grant,
    };
  }

  public async submitRegistryRequest(
    credential: ControlPlaneCredential,
    submission: RegistryRequestSubmission,
    otp?: string,
  ): Promise<{ requestId: string; status: RegistryRequestStatus; message: string }> {
    const value = await this.requestJson(credential, 'POST', '/v1/registry-requests', {
      body: JSON.stringify(submission),
      headers: {
        'content-type': 'application/json',
        'x-uapkg-idempotency-key': randomUUID(),
        ...(otp ? { 'x-uapkg-otp': otp } : {}),
      },
    });
    const parsed = z
      .object({
        ok: z.literal(true),
        requestId: z.string().min(1),
        status: requestStatusSchema,
        message: z.string(),
      })
      .safeParse(value);
    if (!parsed.success) {
      throw new ControlPlaneError('REGISTRY_REQUEST_RESPONSE_INVALID', 'The publishing request response was invalid.');
    }
    return parsed.data;
  }

  public async getRegistryRequest(
    credential: ControlPlaneCredential,
    requestId: string,
  ): Promise<RegistryRequestSummary> {
    const value = await this.requestJson(credential, 'GET', `/v1/registry-requests/${encodeURIComponent(requestId)}`);
    const parsed = z.object({ ok: z.literal(true), request: requestSummarySchema }).safeParse(value);
    if (!parsed.success) {
      throw new ControlPlaneError('REGISTRY_REQUEST_RESPONSE_INVALID', 'The publishing request response was invalid.');
    }
    return parsed.data.request;
  }

  public async listRegistryRequests(
    credential: ControlPlaneCredential,
    registryId: string,
    status?: RegistryRequestStatus,
  ): Promise<RegistryRequestSummary[]> {
    const query = new URLSearchParams({ registryId });
    if (status) query.set('status', status);
    const value = await this.requestJson(credential, 'GET', `/v1/registry-requests?${query}`);
    const parsed = z
      .object({
        ok: z.literal(true),
        recentRequests: z.array(requestSummarySchema).optional(),
        requests: z.array(requestSummarySchema).optional(),
      })
      .safeParse(value);
    if (!parsed.success || (!parsed.data.recentRequests && !parsed.data.requests)) {
      throw new ControlPlaneError(
        'REGISTRY_REQUEST_LIST_RESPONSE_INVALID',
        'The publishing request list response was invalid.',
      );
    }
    return parsed.data.recentRequests ?? parsed.data.requests ?? [];
  }

  private async requestJson(
    credential: ControlPlaneCredential,
    method: string,
    path: string,
    init: {
      readonly headers?: Readonly<Record<string, string>>;
      readonly body?: string;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<unknown> {
    const url = new URL(path, this.apiBaseUrl);
    const headers = new Headers(init.headers);
    let response: Response;

    if (credential.kind === 'dpop') {
      try {
        response = await this.withDPoPNonceRetry(() =>
          oauth.protectedResourceRequest(credential.accessToken, method, url, headers, init.body, {
            DPoP: credential.dpop,
            signal: boundedRequestSignal(init.signal),
          }),
        );
      } catch (error) {
        if (error instanceof oauth.WWWAuthenticateChallengeError) {
          throw new ControlPlaneError(
            'CONTROL_PLANE_AUTHENTICATION_REQUIRED',
            'The UAPKG control plane rejected the saved login.',
            401,
            undefined,
            { cause: error },
          );
        }
        throw error;
      }
    } else {
      headers.set('authorization', `Bearer ${credential.accessToken}`);
      response = await fetch(url, {
        method,
        headers,
        body: init.body,
        redirect: 'error',
        signal: boundedRequestSignal(init.signal),
      });
    }

    const value = await readJson(response);
    if (!response.ok) {
      const parsed = errorSchema.safeParse(value);
      if (parsed.success) {
        throw new ControlPlaneError(
          parsed.data.error.code,
          parsed.data.error.message,
          response.status,
          parsed.data.error.details,
        );
      }
      throw new ControlPlaneError(
        `HTTP_${response.status}`,
        `The UAPKG control plane returned HTTP ${response.status}.`,
        response.status,
      );
    }
    return value;
  }

  private async withDPoPNonceRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!oauth.isDPoPNonceError(error)) throw error;
      return operation();
    }
  }
}

function boundedRequestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(30_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ControlPlaneError(
      'CONTROL_PLANE_RESPONSE_NOT_JSON',
      `The UAPKG control plane returned a non-JSON response (HTTP ${response.status}).`,
      response.status,
      undefined,
      { cause: error },
    );
  }
}
