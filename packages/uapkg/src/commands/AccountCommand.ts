import { z } from 'zod';
import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGAccountAction, UAPKGTokenAccessMode } from '../cli/UAPKGCommandLine.js';
import type { Command } from './Command.js';

const resourceAccessSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('none') }),
  z.object({ mode: z.literal('all') }),
  z.object({ mode: z.literal('selected'), resourceIds: z.array(z.string().uuid()).min(1).max(50) }),
]);

const accountTokenSummarySchema = z.object({
  id: z.string().uuid(),
  ownerUserId: z.string().uuid(),
  name: z.string().min(1),
  displayPrefix: z.string().min(1),
  status: z.enum(['active', 'disabled', 'revoked']),
  approvalStatus: z.enum(['pending', 'approved', 'denied']),
  resourceOwnerOrganizationId: z.string().uuid(),
  registryAccess: resourceAccessSchema,
  packageAccess: resourceAccessSchema,
  permissions: z.array(z.string()).min(1),
  createdAt: z.number(),
  requestedAt: z.number(),
  expiresAt: z.number(),
  firstUsedAt: z.number().optional(),
  lastUsedAt: z.number().optional(),
  revokedAt: z.number().optional(),
  requestJustification: z.string().optional(),
  decidedAt: z.number().optional(),
  decidedByUserId: z.string().uuid().optional(),
  decisionReason: z.string().optional(),
});

const accountErrorPayloadSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const accountCapabilitiesPayloadSchema = z.object({
  ok: z.literal(true),
  capabilities: z.object({
    canCreateApiTokens: z.boolean(),
    canRevokeApiTokens: z.boolean(),
    reasons: z.array(z.string()).default([]),
    freshAuth: z
      .object({
        isFresh: z.boolean(),
        status: z.string(),
      })
      .optional(),
  }),
});

const accountBootstrapPayloadSchema = z.object({
  ok: z.literal(true),
  session: z.object({
    actorType: z.string(),
    actorId: z.string(),
    accountState: z.string(),
    securedAccount: z.boolean(),
    canWrite: z.boolean(),
  }),
  capabilities: accountCapabilitiesPayloadSchema.shape.capabilities.optional(),
});

const accountTokenListPayloadSchema = z.object({
  ok: z.literal(true),
  apiTokens: z.array(accountTokenSummarySchema),
});

const accountTokenCreatePayloadSchema = z.object({
  ok: z.literal(true),
  apiToken: accountTokenSummarySchema.extend({ token: z.string().min(1) }),
});

interface ApiFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

type ApiResult<TData> =
  | {
      readonly ok: true;
      readonly status: number;
      readonly value: TData;
    }
  | {
      readonly ok: false;
      readonly error: ApiFailure;
    };

export interface AccountCommandOptions {
  readonly action: UAPKGAccountAction;
  readonly outputFormat: 'text' | 'json';
  readonly apiUrl?: string;
  readonly bearerToken?: string;
  readonly tokenId?: string;
  readonly tokenName?: string;
  readonly tokenResourceOwnerOrganizationId?: string;
  readonly tokenRegistryAccessMode: UAPKGTokenAccessMode;
  readonly tokenRegistryIds: readonly string[];
  readonly tokenPackageAccessMode: UAPKGTokenAccessMode;
  readonly tokenPackageIds: readonly string[];
  readonly tokenPermissions: readonly string[];
  readonly tokenExpiresInDays?: number;
  readonly tokenJustification?: string;
}

interface RequestContext {
  readonly baseUrl: string;
  readonly headers: Record<string, string>;
}

export class AccountCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: AccountCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    const context = this.resolveRequestContext();
    if (!context.ok) {
      this.emitError(context.error);
      return 1;
    }

    switch (this.options.action) {
      case 'status':
        return this.runStatus(context.value);
      case 'logout':
        return this.runLogout(context.value);
      case 'token-list':
        return this.runTokenList(context.value);
      case 'token-create':
        return this.runTokenCreate(context.value);
      case 'token-revoke':
        return this.runTokenRevoke(context.value);
    }
  }

  private async runStatus(context: RequestContext): Promise<number> {
    const result = await this.requestJson<unknown>(context, {
      method: 'GET',
      path: '/v1/github-user-app/account/bootstrap?includeCapabilities=true',
    });

    if (!result.ok) {
      this.emitError(result.error);
      return 1;
    }

    const parsed = accountBootstrapPayloadSchema.safeParse(result.value);
    if (!parsed.success) {
      this.emitError({
        status: 500,
        code: 'ACCOUNT_BOOTSTRAP_RESPONSE_INVALID',
        message: 'Account bootstrap response did not match the expected shape.',
      });
      return 1;
    }

    const payload = parsed.data;
    if (this.options.outputFormat === 'json') {
      this.emitJson('ok', {
        action: 'status',
        session: payload.session,
        capabilities: payload.capabilities,
      });
      return 0;
    }

    process.stdout.write(`Actor: ${payload.session.actorId} (${payload.session.actorType})\n`);
    process.stdout.write(`Account state: ${payload.session.accountState}\n`);
    process.stdout.write(`Secured account: ${payload.session.securedAccount ? 'yes' : 'no'}\n`);
    process.stdout.write(`Can write: ${payload.session.canWrite ? 'yes' : 'no'}\n`);

    if (payload.capabilities) {
      process.stdout.write(`Can create API tokens: ${payload.capabilities.canCreateApiTokens ? 'yes' : 'no'}\n`);
      process.stdout.write(`Can revoke API tokens: ${payload.capabilities.canRevokeApiTokens ? 'yes' : 'no'}\n`);
      if (payload.capabilities.freshAuth) {
        process.stdout.write(`Fresh auth status: ${payload.capabilities.freshAuth.status}\n`);
      }
      if (payload.capabilities.reasons.length > 0) {
        process.stdout.write(`Capability reasons: ${payload.capabilities.reasons.join(', ')}\n`);
      }
    }

    return 0;
  }

  private async runLogout(context: RequestContext): Promise<number> {
    const result = await this.requestJson<unknown>(context, {
      method: 'DELETE',
      path: '/v1/github-user-app/account/session',
      expectNoContent: true,
    });

    if (!result.ok) {
      this.emitError(result.error);
      return 1;
    }

    if (this.options.outputFormat === 'json') {
      this.emitJson('ok', {
        action: 'logout',
        revoked: true,
      });
    } else {
      process.stdout.write('Account session revoked.\n');
    }

    return 0;
  }

  private async runTokenList(context: RequestContext): Promise<number> {
    const result = await this.requestJson<unknown>(context, {
      method: 'GET',
      path: '/v1/account/api-tokens',
    });

    if (!result.ok) {
      this.emitError(result.error);
      return 1;
    }

    const parsed = accountTokenListPayloadSchema.safeParse(result.value);
    if (!parsed.success) {
      this.emitError({
        status: 500,
        code: 'ACCOUNT_API_TOKEN_LIST_RESPONSE_INVALID',
        message: 'Account API token list response did not match the expected shape.',
      });
      return 1;
    }

    if (this.options.outputFormat === 'json') {
      this.emitJson('ok', {
        action: 'token-list',
        apiTokens: parsed.data.apiTokens,
      });
      return 0;
    }

    if (parsed.data.apiTokens.length === 0) {
      process.stdout.write('No account API tokens found.\n');
      return 0;
    }

    for (const token of parsed.data.apiTokens) {
      process.stdout.write(
        `${token.id} ${token.name} resourceOwner=${token.resourceOwnerOrganizationId}` +
          ` registryAccess=${formatAccess(token.registryAccess)} packageAccess=${formatAccess(token.packageAccess)}` +
          ` approval=${token.approvalStatus} status=${token.status} expiresAt=${token.expiresAt}\n`,
      );
    }

    return 0;
  }

  private async runTokenCreate(context: RequestContext): Promise<number> {
    const capability = await this.ensureMutationCapability(
      context,
      'canCreateApiTokens',
      'ACCOUNT_API_TOKEN_CREATE_FORBIDDEN',
    );
    if (!capability.ok) {
      this.emitError(capability.error);
      return 1;
    }

    const tokenName = (this.options.tokenName ?? '').trim();
    if (tokenName.length === 0) {
      this.emitError({
        status: 400,
        code: 'ACCOUNT_API_TOKEN_INPUT_INVALID',
        message: '--name is required for account token-create.',
      });
      return 1;
    }

    const resourceOwnerOrganizationId = (this.options.tokenResourceOwnerOrganizationId ?? '').trim();
    if (resourceOwnerOrganizationId.length === 0) {
      this.emitError({
        status: 400,
        code: 'ACCOUNT_API_TOKEN_INPUT_INVALID',
        message: '--resource-owner is required for account token-create.',
      });
      return 1;
    }
    if (!z.string().uuid().safeParse(resourceOwnerOrganizationId).success) {
      this.emitError({
        status: 400,
        code: 'ACCOUNT_API_TOKEN_INPUT_INVALID',
        message: '--resource-owner must be an organization UUID.',
      });
      return 1;
    }

    const expiresInDays = this.options.tokenExpiresInDays;
    if (
      typeof expiresInDays !== 'number' ||
      !Number.isInteger(expiresInDays) ||
      expiresInDays < 1 ||
      expiresInDays > 366
    ) {
      this.emitError({
        status: 400,
        code: 'ACCOUNT_API_TOKEN_INPUT_INVALID',
        message: '--expires-in-days must be an integer between 1 and 366.',
      });
      return 1;
    }

    const registryAccess = buildTokenResourceAccess(
      this.options.tokenRegistryAccessMode,
      this.options.tokenRegistryIds,
      '--registry-access',
      '--registry-id',
    );
    if (!registryAccess.ok) {
      this.emitError(registryAccess.error);
      return 1;
    }
    const packageAccess = buildTokenResourceAccess(
      this.options.tokenPackageAccessMode,
      this.options.tokenPackageIds,
      '--package-access',
      '--package-id',
    );
    if (!packageAccess.ok) {
      this.emitError(packageAccess.error);
      return 1;
    }

    const requiredPermissions = [
      'organization.read',
      ...(registryAccess.value.mode === 'none' ? [] : ['registry.read']),
      ...(packageAccess.value.mode === 'none' ? [] : ['package.read']),
    ];
    const optionalPermissions = normalizeUniqueValues(this.options.tokenPermissions);
    const permissions = [...new Set([...requiredPermissions, ...optionalPermissions])];
    const justification = this.options.tokenJustification?.trim();

    const result = await this.requestJson<unknown>(context, {
      method: 'POST',
      path: '/v1/account/api-tokens',
      body: {
        name: tokenName,
        expiresInDays,
        resourceOwnerOrganizationId,
        registryAccess: registryAccess.value,
        packageAccess: packageAccess.value,
        permissions,
        ...(justification ? { justification } : {}),
      },
    });

    if (!result.ok) {
      this.emitError(result.error);
      return 1;
    }

    const parsed = accountTokenCreatePayloadSchema.safeParse(result.value);
    if (!parsed.success) {
      this.emitError({
        status: 500,
        code: 'ACCOUNT_API_TOKEN_CREATE_RESPONSE_INVALID',
        message: 'Account API token create response did not match the expected shape.',
      });
      return 1;
    }

    const created = parsed.data.apiToken;
    if (this.options.outputFormat === 'json') {
      this.emitJson('ok', {
        action: 'token-create',
        apiToken: created,
      });
      return 0;
    }

    process.stdout.write(`Created account API token ${created.id} (${created.name}).\n`);
    process.stdout.write(`Resource owner: ${created.resourceOwnerOrganizationId}\n`);
    process.stdout.write(`Approval status: ${created.approvalStatus}.\n`);
    if (created.approvalStatus === 'pending') {
      process.stdout.write('This token cannot authorize actions until an organization token manager approves it.\n');
    }
    process.stdout.write('Token secret (shown only once):\n');
    process.stdout.write(`${created.token}\n`);
    process.stdout.write('Store this token now. It cannot be retrieved again after this response.\n');

    return 0;
  }

  private async runTokenRevoke(context: RequestContext): Promise<number> {
    const capability = await this.ensureMutationCapability(
      context,
      'canRevokeApiTokens',
      'ACCOUNT_API_TOKEN_REVOKE_FORBIDDEN',
    );
    if (!capability.ok) {
      this.emitError(capability.error);
      return 1;
    }

    const tokenId = (this.options.tokenId ?? '').trim();
    if (tokenId.length === 0) {
      this.emitError({
        status: 400,
        code: 'ACCOUNT_API_TOKEN_QUERY_INVALID',
        message: '--token-id is required for account token-revoke.',
      });
      return 1;
    }

    const result = await this.requestJson<unknown>(context, {
      method: 'DELETE',
      path: `/v1/account/api-tokens/${encodeURIComponent(tokenId)}`,
      expectNoContent: true,
    });

    if (!result.ok) {
      this.emitError(result.error);
      return 1;
    }

    if (this.options.outputFormat === 'json') {
      this.emitJson('ok', {
        action: 'token-revoke',
        tokenId,
        revoked: true,
      });
    } else {
      process.stdout.write(`Revoked account API token ${tokenId}.\n`);
    }

    return 0;
  }

  private async ensureMutationCapability(
    context: RequestContext,
    key: 'canCreateApiTokens' | 'canRevokeApiTokens',
    fallbackCode: 'ACCOUNT_API_TOKEN_CREATE_FORBIDDEN' | 'ACCOUNT_API_TOKEN_REVOKE_FORBIDDEN',
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: ApiFailure }> {
    const result = await this.requestJson<unknown>(context, {
      method: 'GET',
      path: '/v1/github-user-app/account/capabilities',
    });

    if (!result.ok) {
      return result;
    }

    const parsed = accountCapabilitiesPayloadSchema.safeParse(result.value);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          status: 500,
          code: 'ACCOUNT_CAPABILITIES_RESPONSE_INVALID',
          message: 'Account capabilities response did not match the expected shape.',
        },
      };
    }

    if (parsed.data.capabilities[key]) {
      return { ok: true };
    }

    const reasonCode = parsed.data.capabilities.reasons[0] ?? fallbackCode;
    const freshAuthReason =
      parsed.data.capabilities.freshAuth && parsed.data.capabilities.freshAuth.isFresh === false
        ? ` (fresh auth status: ${parsed.data.capabilities.freshAuth.status})`
        : '';

    return {
      ok: false,
      error: {
        status: 403,
        code: reasonCode,
        message: `Account capabilities deny this action.${freshAuthReason}`,
      },
    };
  }

  private resolveRequestContext():
    | {
        readonly ok: true;
        readonly value: RequestContext;
      }
    | {
        readonly ok: false;
        readonly error: ApiFailure;
      } {
    const baseUrl = normalizeBaseUrl(
      this.options.apiUrl ?? process.env.UAPKG_ACCOUNT_API_URL ?? 'https://api.uapkg.dev',
    );

    const bearerToken = normalizeBearerToken(this.options.bearerToken ?? process.env.UAPKG_ACCOUNT_BEARER_TOKEN);
    if (bearerToken) {
      return {
        ok: true,
        value: {
          baseUrl,
          headers: {
            authorization: bearerToken,
          },
        },
      };
    }

    return {
      ok: false,
      error: {
        status: 401,
        code: 'ACCOUNT_AUTH_REQUIRED',
        message: 'Provide --bearer (or UAPKG_ACCOUNT_BEARER_TOKEN) to authenticate account commands.',
      },
    };
  }

  private async requestJson<TData>(
    context: RequestContext,
    input: {
      readonly method: 'GET' | 'POST' | 'DELETE';
      readonly path: string;
      readonly body?: unknown;
      readonly expectNoContent?: boolean;
    },
  ): Promise<ApiResult<TData>> {
    const firstAttempt = await this.requestJsonOnce<TData>(context, input);
    if (firstAttempt.ok) {
      return firstAttempt;
    }

    return {
      ok: false,
      error: this.withAuthHint(firstAttempt.error),
    };
  }

  private async requestJsonOnce<TData>(
    context: RequestContext,
    input: {
      readonly method: 'GET' | 'POST' | 'DELETE';
      readonly path: string;
      readonly body?: unknown;
      readonly expectNoContent?: boolean;
    },
  ): Promise<ApiResult<TData>> {
    try {
      const response = await fetch(`${context.baseUrl}${input.path}`, {
        method: input.method,
        headers: {
          accept: 'application/json',
          ...(input.body ? { 'content-type': 'application/json' } : {}),
          ...context.headers,
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
      });

      if (input.expectNoContent && response.status === 204) {
        return {
          ok: true,
          status: 204,
          value: undefined as TData,
        };
      }

      const payload = await this.parseResponsePayload(response);

      if (!response.ok) {
        return {
          ok: false,
          error: this.toApiFailure(response.status, payload),
        };
      }

      return {
        ok: true,
        status: response.status,
        value: payload as TData,
      };
    } catch (error) {
      return {
        ok: false,
        error: {
          status: 0,
          code: 'ACCOUNT_NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private withAuthHint(error: ApiFailure): ApiFailure {
    if (
      error.status === 401 ||
      error.code === 'AUTH_REQUIRED' ||
      error.code === 'TOKEN_INVALID' ||
      error.code === 'TOKEN_REVOKED' ||
      error.code === 'TOKEN_EXPIRED'
    ) {
      return {
        ...error,
        message: `${error.message} Provide --bearer (or UAPKG_ACCOUNT_BEARER_TOKEN) for account command authentication.`,
      };
    }

    return error;
  }

  private async parseResponsePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      return {
        ok: false,
        error: {
          code: 'NON_JSON_RESPONSE',
          message: text.length > 0 ? text : `Endpoint returned non-JSON response with status ${response.status}.`,
        },
      };
    }

    return response.json();
  }

  private toApiFailure(status: number, payload: unknown): ApiFailure {
    const parsed = accountErrorPayloadSchema.safeParse(payload);
    if (parsed.success) {
      return {
        status,
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        details: parsed.data.error.details,
      };
    }

    return {
      status,
      code: 'ACCOUNT_API_REQUEST_FAILED',
      message: `Account API request failed with status ${status}.`,
    };
  }

  private emitError(error: ApiFailure): void {
    if (this.options.outputFormat === 'json') {
      this.emitJson('error', {
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
      });
      return;
    }

    process.stderr.write(`[uapkg] ${error.code}: ${error.message}\n`);
  }

  private emitJson(status: 'ok' | 'error', data: unknown): void {
    this.root.json.emit({
      status,
      command: 'account',
      data,
      diagnostics: [],
    });
  }
}

type TokenResourceAccess = z.infer<typeof resourceAccessSchema>;

function buildTokenResourceAccess(
  mode: UAPKGTokenAccessMode,
  rawResourceIds: readonly string[],
  modeFlag: string,
  resourceFlag: string,
): { readonly ok: true; readonly value: TokenResourceAccess } | { readonly ok: false; readonly error: ApiFailure } {
  const resourceIds = rawResourceIds.map((resourceId) => resourceId.trim()).filter(Boolean);
  if (new Set(resourceIds).size !== resourceIds.length) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'ACCOUNT_API_TOKEN_RESOURCE_ACCESS_INVALID',
        message: `${resourceFlag} values must be unique.`,
      },
    };
  }

  if (mode !== 'selected') {
    if (resourceIds.length > 0) {
      return {
        ok: false,
        error: {
          status: 400,
          code: 'ACCOUNT_API_TOKEN_RESOURCE_ACCESS_INVALID',
          message: `${resourceFlag} may be used only when ${modeFlag}=selected.`,
        },
      };
    }
    return { ok: true, value: { mode } };
  }

  if (resourceIds.length < 1 || resourceIds.length > 50) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'ACCOUNT_API_TOKEN_RESOURCE_ACCESS_INVALID',
        message: `${modeFlag}=selected requires between 1 and 50 ${resourceFlag} values.`,
      },
    };
  }

  if (resourceIds.some((resourceId) => !z.string().uuid().safeParse(resourceId).success)) {
    return {
      ok: false,
      error: {
        status: 400,
        code: 'ACCOUNT_API_TOKEN_RESOURCE_ACCESS_INVALID',
        message: `${resourceFlag} values must be resource UUIDs.`,
      },
    };
  }

  return { ok: true, value: { mode, resourceIds } };
}

function normalizeUniqueValues(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatAccess(access: TokenResourceAccess): string {
  return access.mode === 'selected' ? `selected(${access.resourceIds.length})` : access.mode;
}

function normalizeBaseUrl(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

function normalizeBearerToken(input: string | undefined): string | undefined {
  const token = (input ?? '').trim();
  if (token.length === 0) {
    return undefined;
  }

  return token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
}
