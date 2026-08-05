import { UAPKG_CONTROL_PLANE_ENDPOINTS } from './ControlPlaneEndpoints.js';

export const UAPKG_AUTHORIZATION_ISSUER = UAPKG_CONTROL_PLANE_ENDPOINTS.issuer;
export const UAPKG_CONTROL_PLANE_API = UAPKG_CONTROL_PLANE_ENDPOINTS.apiBaseUrl;
export const UAPKG_CLI_CLIENT_ID = 'uapkg-cli';
export const UAPKG_GITHUB_OIDC_AUDIENCE = 'uapkg';

export const UAPKG_CLI_SCOPES = [
  'identity.self.read',
  'publishing.request.create',
  'publishing.request.read.self',
  'registry_grant.revoke.self',
] as const;

export type UAPKGCliScope = (typeof UAPKG_CLI_SCOPES)[number];
const UAPKG_CLI_SCOPE_SET = new Set<string>(UAPKG_CLI_SCOPES);
const OAUTH_SCOPE_TOKEN_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

export function knownUAPKGCliScopes(value: unknown): UAPKGCliScope[] {
  if (!Array.isArray(value)) return [];
  const candidates = new Set(value.filter((scope): scope is string => typeof scope === 'string'));
  return UAPKG_CLI_SCOPES.filter((scope) => candidates.has(scope));
}

export function parseUAPKGCliScopeString(value: unknown): UAPKGCliScope[] {
  return knownUAPKGCliScopes(parseOAuthScopeTokens(value));
}

export function parseOAuthScopeTokens(value: unknown): string[] {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) return [];
  const scopes = value.split(' ');
  if (scopes.some((scope) => !isOAuthScopeToken(scope))) return [];
  return [...new Set(scopes)];
}

export function isOAuthScopeToken(value: unknown): value is string {
  return typeof value === 'string' && OAUTH_SCOPE_TOKEN_PATTERN.test(value);
}

export function isUAPKGCliScope(value: unknown): value is UAPKGCliScope {
  return typeof value === 'string' && UAPKG_CLI_SCOPE_SET.has(value);
}

export type ControlPlaneAuthMode = 'auto' | 'login' | 'gat' | 'oidc';

export interface RegistryTrust {
  readonly alias: string;
  readonly registryId: string;
  readonly registryName: string;
  readonly repositoryUrl: string;
  readonly repositoryFingerprint: string;
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly resource: string;
  readonly cacheShortId: string;
}

export interface AccountDisplayMetadata {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface AccountSelf {
  readonly account: AccountDisplayMetadata;
  readonly registry: {
    readonly id: string;
  };
  readonly grant: {
    readonly id: string;
    readonly deviceName: string;
    readonly idleExpiresAt: string;
    readonly absoluteExpiresAt: string;
    readonly scopes: readonly string[];
  };
}

export interface CliLoginConfirmation extends AccountSelf {
  readonly grant: AccountSelf['grant'] & {
    readonly status: 'pending' | 'active';
    readonly activationExpiresAt: string;
    readonly replacesGrantId: string | null;
  };
}

export interface ActivatedCliLoginGrant {
  readonly id: string;
  readonly status: 'active';
  readonly replacesGrantId: string | null;
}

export interface RegistryGrantMetadata {
  readonly issuer: string;
  readonly registryId: string;
  readonly registryName: string;
  readonly grantId: string;
  readonly clientId: string;
  readonly keyReference: string;
  readonly refreshTokenReference: string;
  readonly publicKeyThumbprint: string;
  readonly deviceName: string;
  readonly repositoryFingerprint: string;
  readonly account: AccountDisplayMetadata;
  readonly createdAt: number;
  readonly idleExpiresAt: number;
  readonly expiresAt: number;
}

export interface AuthMetadataFile {
  readonly schemaVersion: 1;
  readonly grants: Readonly<Record<string, RegistryGrantMetadata>>;
}

export interface RegistryRequestSource {
  readonly type: 'github_release';
  readonly repository: string;
  readonly releaseTag: string;
  readonly assetName: string;
}

/** Artifact integrity observed by this client from the exact bytes it inspected. */
export interface ObservedArtifactIntegrity {
  /** Exactly `sha256:` + 64 lowercase hex characters. */
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Normalized packaged-manifest claims submitted with a publish request. */
export interface SubmittedPackageClaims {
  readonly name: string;
  readonly version: string;
  readonly private: boolean;
  readonly dependencies: Readonly<Record<string, { readonly version: string; readonly registry?: string }>>;
  readonly devDependencies: Readonly<Record<string, { readonly version: string; readonly registry?: string }>>;
  readonly peerDependencies: Readonly<Record<string, { readonly version: string; readonly registry?: string }>>;
}

/** The six route-derived registry operations (PS-REQ-001). */
export type RegistryOperation = 'publish' | 'unpublish' | 'yank' | 'unyank' | 'deprecate' | 'undeprecate';

/**
 * Body for `POST /v1/registry-requests/{operation}`. The operation is
 * derived from the route; the body never carries a kind.
 */
export interface RegistryRequestSubmission {
  readonly registryId: string;
  readonly ownerOrganizationName?: string;
  readonly payload: {
    readonly packageName: string;
    readonly packageVersion: string;
    readonly source?: RegistryRequestSource;
    readonly observedIntegrity?: ObservedArtifactIntegrity;
    readonly claims?: SubmittedPackageClaims;
    readonly reason?: string;
  };
}

export type RegistryRequestStatus =
  | 'queued'
  | 'checking'
  | 'accepted'
  | 'ready'
  | 'ready_superseded'
  | 'rejected'
  | 'operationally_failed';

export interface RegistryRequestSummary {
  readonly id: string;
  readonly registryId: string;
  readonly kind: string;
  readonly status: RegistryRequestStatus;
  readonly currentStep?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly payload?: {
    readonly packageName?: string;
    readonly packageVersion?: string;
  };
}

export interface ControlPlaneApiErrorBody {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export class ControlPlaneError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
    public readonly details?: Readonly<Record<string, unknown>>,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ControlPlaneError';
  }
}

export class OAuthScopeInsufficientError extends ControlPlaneError {
  public readonly requestedScopes: readonly UAPKGCliScope[];
  public readonly requiredScopes: readonly UAPKGCliScope[];
  public readonly missingScopes: readonly UAPKGCliScope[];

  public constructor(
    message: string,
    public readonly registryAlias: string,
    requestedScopes: readonly UAPKGCliScope[],
    requiredScopes: readonly UAPKGCliScope[],
    missingScopes: readonly UAPKGCliScope[],
    status = 403,
    options?: ErrorOptions,
  ) {
    const requested = knownUAPKGCliScopes(requestedScopes);
    const required = knownUAPKGCliScopes(requiredScopes);
    const missing = knownUAPKGCliScopes(missingScopes).filter(
      (scope) => requested.includes(scope) && required.includes(scope),
    );
    super(
      'OAUTH_SCOPE_INSUFFICIENT',
      message,
      status,
      { requestedScopes: requested, requiredScopes: required, missingScopes: missing },
      options,
    );
    this.name = 'OAuthScopeInsufficientError';
    this.requestedScopes = requested;
    this.requiredScopes = required;
    this.missingScopes = missing;
  }
}

export class OAuthScopeUnsupportedError extends ControlPlaneError {
  public readonly requestedScopes: readonly UAPKGCliScope[];
  public readonly unsupportedScopes: readonly UAPKGCliScope[];
  public readonly reason: 'issuer-does-not-support-requested-scope' | 'cli-update-required';

  public constructor(
    public readonly registryAlias: string,
    requestedScopes: readonly UAPKGCliScope[],
    unsupportedScopes: readonly UAPKGCliScope[],
    options?: ErrorOptions & {
      readonly reason?: 'issuer-does-not-support-requested-scope' | 'cli-update-required';
      readonly status?: number;
    },
  ) {
    const requested = knownUAPKGCliScopes(requestedScopes);
    const unsupported = knownUAPKGCliScopes(unsupportedScopes).filter((scope) => requested.includes(scope));
    const reason = options?.reason ?? 'issuer-does-not-support-requested-scope';
    const message =
      reason === 'cli-update-required'
        ? `The authorization service for "${registryAlias}" requires an OAuth capability that this UAPKG CLI version does not recognize. Update UAPKG CLI and try again.`
        : unsupportedIssuerScopeMessage(registryAlias, unsupported);
    super(
      'OAUTH_SCOPE_UNSUPPORTED',
      message,
      options?.status,
      { requestedScopes: requested, unsupportedScopes: unsupported, reason },
      options,
    );
    this.name = 'OAuthScopeUnsupportedError';
    this.requestedScopes = requested;
    this.unsupportedScopes = unsupported;
    this.reason = reason;
  }
}

function unsupportedIssuerScopeMessage(registryAlias: string, unsupportedScopes: readonly UAPKGCliScope[]): string {
  const noun = unsupportedScopes.length === 1 ? 'scope' : 'scopes';
  return `The authorization service for "${registryAlias}" does not support the OAuth ${noun} required by this UAPKG CLI: ${unsupportedScopes.join(', ')}. Update UAPKG CLI and try again; if it is already current, the authorization service must be updated.`;
}

export function registryAudience(registryId: string): string {
  return `${UAPKG_CONTROL_PLANE_API}/v1/registries/${encodeURIComponent(registryId)}`;
}
