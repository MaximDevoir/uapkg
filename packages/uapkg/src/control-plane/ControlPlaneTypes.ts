export const UAPKG_AUTHORIZATION_ISSUER = 'https://account.uapkg.dev/oauth';
export const UAPKG_CONTROL_PLANE_API = 'https://api.uapkg.dev';
export const UAPKG_CLI_CLIENT_ID = 'uapkg-cli';
export const UAPKG_GITHUB_OIDC_AUDIENCE = 'uapkg';

export const UAPKG_CLI_SCOPES = [
  'identity.self.read',
  'publishing.request.create',
  'publishing.request.read.self',
  'registry_grant.revoke.self',
] as const;

export type UAPKGCliScope = (typeof UAPKG_CLI_SCOPES)[number];
export type ControlPlaneAuthMode = 'auto' | 'login' | 'gat' | 'oidc';

export interface RegistryTrust {
  readonly alias: string;
  readonly registryId: string;
  readonly registryName: string;
  readonly registryIdentifier: string;
  readonly repositoryUrl: string;
  readonly repositoryFingerprint: string;
  readonly issuer: string;
  readonly apiBaseUrl: string;
  readonly resource: string;
  readonly cacheShortId: string;
}

export interface AccountDisplayMetadata {
  readonly id: string;
  readonly username?: string;
  readonly displayName?: string;
  readonly email?: string;
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
  readonly account?: AccountDisplayMetadata;
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
  readonly pathToManifest: string;
}

export interface RegistryRequestSubmission {
  readonly registryId: string;
  readonly kind: 'publish_new_package' | 'publish_new_version';
  readonly ownerOrganizationName?: string;
  readonly payload: {
    readonly packageName: string;
    readonly packageVersion: string;
    readonly source: RegistryRequestSource;
  };
}

export type RegistryRequestStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_pr_checks'
  | 'accepted'
  | 'failed'
  | 'timed_out'
  | 'finalization_failed';

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

export function registryAudience(registryId: string): string {
  return `${UAPKG_CONTROL_PLANE_API}/v1/registries/${encodeURIComponent(registryId)}`;
}
