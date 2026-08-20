import {
  createPublishRequestFailedDiagnostic,
  type PublishDiagnosticFact,
  type PublishDiagnosticResource,
  type PublishRequestFailedDiagnostic,
} from '@uapkg/diagnostics';
import { z } from 'zod';
import { ControlPlaneError } from './ControlPlaneTypes.js';

const SERVER_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;

const boundedText = (maximumLength: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximumLength)
    .refine((value) => !hasUnsafeDisplayCharacter(value));
const packageNameSchema = boundedText(214);
const packageVersionSchema = boundedText(256);
const ownerNameSchema = boundedText(100).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
const repositorySchema = boundedText(255).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u);
const requestIdSchema = boundedText(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const accessModeSchema = z.enum(['none', 'selected', 'all']);
const missingCapabilitiesSchema = z
  .array(z.enum(['package.publish', 'publishing.request.create']))
  .max(10)
  .transform((values) => [...new Set(values)]);
const missingOAuthScopesSchema = z
  .array(z.enum(['publishing.request.create', 'publishing.request.read.self']))
  .max(2)
  .transform((values) => [...new Set(values)]);
const ownerNamesSchema = z
  .array(ownerNameSchema)
  .max(20)
  .transform((values) => [...new Set(values)].sort());

const emptyDetailsSchema = z.object({});
const packageDetailsSchema = z.object({ packageName: packageNameSchema.optional() });
const ownerRequiredDetailsSchema = packageDetailsSchema;
const requestedOwnerDetailsSchema = packageDetailsSchema.extend({
  requestedOwnerOrganizationName: ownerNameSchema.optional(),
  ownerOrganizationName: ownerNameSchema.optional(),
  allowedOwnerOrganizationNames: ownerNamesSchema.optional(),
});
const gatOwnerMismatchDetailsSchema = packageDetailsSchema.extend({
  requestedOwnerOrganizationName: ownerNameSchema.optional(),
  tokenOwnerOrganizationNames: ownerNamesSchema.optional(),
});
const scopeMismatchDetailsSchema = packageDetailsSchema.extend({
  requestedScopeOwner: ownerNameSchema.optional(),
  scopeOwner: ownerNameSchema.optional(),
  allowedScopeOwners: ownerNamesSchema.optional(),
  tokenOwnerOrganizationNames: ownerNamesSchema.optional(),
});
const tokenAccessDetailsSchema = packageDetailsSchema.extend({
  actualPackageAccessMode: accessModeSchema.optional(),
  requiredPackageAccessMode: z.literal('all').optional(),
  missingCapabilities: missingCapabilitiesSchema.optional(),
  packageAccess: z.object({ mode: accessModeSchema }).optional(),
  actualRegistryAccessMode: accessModeSchema.optional(),
  requiredRegistryAccessModes: z
    .array(z.enum(['selected', 'all']))
    .max(2)
    .optional(),
  requiredPackageAccessModes: z
    .array(z.enum(['selected', 'all']))
    .max(2)
    .optional(),
  registryAccess: z.object({ mode: accessModeSchema }).optional(),
});
const tokenPermissionDetailsSchema = z.object({
  missingCapabilities: missingCapabilitiesSchema.optional(),
});
const oauthScopeDetailsSchema = z.object({
  missingScopes: missingOAuthScopesSchema.optional(),
});
const oidcRepositoryDetailsSchema = packageDetailsSchema.extend({
  submittedRepository: repositorySchema.optional(),
  trustedRepository: repositorySchema.optional(),
});
const versionDetailsSchema = z.object({
  packageName: packageNameSchema.optional(),
  packageVersion: packageVersionSchema.optional(),
});
const activeRequestDetailsSchema = versionDetailsSchema.extend({
  activeRequestId: requestIdSchema.optional(),
});
const haltedPackageDetailsSchema = packageDetailsSchema.extend({
  blockingRequestId: requestIdSchema.optional(),
});
const retryDetailsSchema = z.object({
  retryAfterSeconds: z.number().int().min(1).max(86_400).optional(),
});

export interface PublishRequestErrorContext {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly registryAlias: string;
  readonly registryName?: string;
  readonly registryIssuer: string;
  readonly credentialKind: 'login' | 'gat' | 'oidc';
  readonly requestedOwner?: string;
  readonly repository: string;
}

type ResourceKind =
  | 'access-tokens'
  | 'help'
  | 'login'
  | 'owner-command'
  | 'requests'
  | 'security'
  | 'registries'
  | 'trusted-publishers';

interface PublishGuidance {
  readonly message: string;
  readonly hint: string;
  readonly facts?: readonly PublishDiagnosticFact[];
  readonly resources?: readonly ResourceKind[];
  readonly requestId?: string;
}

interface PublishErrorSpec {
  build(details: unknown, context: PublishRequestErrorContext): PublishGuidance;
}

function defineSpec<Schema extends z.ZodObject>(
  schema: Schema,
  build: (details: z.output<Schema>, context: PublishRequestErrorContext) => PublishGuidance,
): PublishErrorSpec {
  const empty = schema.parse({});
  return {
    build(details, context) {
      const parsed = schema.safeParse(details ?? {});
      return build(parsed.success ? parsed.data : empty, context);
    },
  };
}

function fixedSpec(message: string, hint: string, resources: readonly ResourceKind[] = []): PublishErrorSpec {
  return defineSpec(emptyDetailsSchema, () => ({ message, hint, resources }));
}

const UPDATE_CLIENT_AND_RETRY =
  'Update UAPKG CLI and try again. If the problem remains, report the server code to the registry operator.';
const RETRY_AND_REPORT =
  'Try publishing again. If the failure continues, report the server code to the registry operator.';
const LOGIN_AGAIN = 'Sign in again for this registry, then retry the publication.';
const CHECK_TOKEN =
  'Create or use an active granular access token with the correct owner, permissions, and package access, then try again.';

const clientRequestSpec = (message: string) => fixedSpec(message, UPDATE_CLIENT_AND_RETRY);
const internalServiceSpec = (message: string) => fixedSpec(message, RETRY_AND_REPORT);
const loginSpec = (message: string) => fixedSpec(message, LOGIN_AGAIN, ['login']);
const tokenSpec = (message: string) => fixedSpec(message, CHECK_TOKEN, ['access-tokens']);

const unscopedOwnerSpec = defineSpec(ownerRequiredDetailsSchema, (_details, context) => {
  const packageName = safeDisplayValue(context.packageName, 214);
  return {
    message: packageName
      ? `"${packageName}" needs an owner organization before it can be published for the first time.`
      : 'This unscoped package needs an owner organization before it can be published for the first time.',
    hint: 'Pass `--owner <organization>`, set `publish.owner` in uapkg.json, or publish the package under an `@organization/name` scope.',
    resources: ['owner-command'],
  };
});

const gatOwnerMismatchSpec = defineSpec(gatOwnerMismatchDetailsSchema, (details, context) => {
  const requestedOwner = details.requestedOwnerOrganizationName ?? safeOwner(context.requestedOwner);
  const tokenOwners = details.tokenOwnerOrganizationNames ?? [];
  const ownerDescription = tokenOwners.length > 0 ? quotedList(tokenOwners) : 'a different organization';
  const requestedDescription = requestedOwner ? `"${requestedOwner}"` : 'the requested organization';
  const scoped = scopedOwner(context.packageName);
  return {
    message: `The selected token was created for ${ownerDescription}, but this publication asks to use ${requestedDescription}.`,
    hint: scoped
      ? `Use a token created for "${scoped}", or rebuild the package under the organization scope this token acts for.`
      : 'Correct or remove the explicit owner, or use a token created for the organization that should own this package.',
    facts: compactFacts([
      fact('requested-owner', requestedOwner),
      ...tokenOwners.map((owner) => fact('token-owner', owner)),
    ]),
    resources: ['access-tokens'],
  };
});

const scopeMismatchSpec = defineSpec(scopeMismatchDetailsSchema, (details, context) => {
  const requestedOwner = details.requestedScopeOwner ?? details.scopeOwner ?? scopedOwner(context.packageName);
  const allowedOwners = details.allowedScopeOwners ?? details.tokenOwnerOrganizationNames ?? [];
  const requestedDescription = requestedOwner ? `"@${requestedOwner}"` : 'The package scope';
  const allowedDescription =
    allowedOwners.length > 0
      ? quotedList(allowedOwners.map((owner) => `@${owner}`))
      : 'the organization this token acts for';
  return {
    message: `${requestedDescription} does not match ${allowedDescription}.`,
    hint: 'Use a token created for the package scope, or rebuild the package under the organization scope this token acts for.',
    facts: compactFacts([
      fact('requested-owner', requestedOwner),
      ...allowedOwners.map((owner) => fact('allowed-owner', owner)),
    ]),
    resources: ['access-tokens'],
  };
});

const initialTokenAccessSpec = defineSpec(tokenAccessDetailsSchema, (details) => {
  const actualMode = details.actualPackageAccessMode ?? details.packageAccess?.mode;
  const requiredMode = details.requiredPackageAccessMode ?? 'all';
  const missing = details.missingCapabilities ?? (actualMode === undefined ? ['package.publish'] : []);
  return {
    message: 'This token cannot create a package during its first publication.',
    hint: 'Create or use a token with Package Access set to All and permission to publish packages.',
    facts: compactFacts([
      fact('actual-access-mode', accessModeLabel(actualMode, 'package')),
      fact('required-access-mode', accessModeLabel(requiredMode, 'package')),
      ...missing.map((capability) => fact('missing-capability', capabilityLabel(capability))),
    ]),
    resources: ['access-tokens'],
  };
});

const tokenPermissionSpec = defineSpec(tokenPermissionDetailsSchema, (details) => ({
  message: 'This token does not allow package publication.',
  hint: 'Create or use a token with permission to publish packages, then try again.',
  facts: (details.missingCapabilities ?? ['package.publish']).map((capability) => ({
    kind: 'missing-capability' as const,
    value: capabilityLabel(capability),
  })),
  resources: ['access-tokens'],
}));

const oauthScopeSpec = defineSpec(oauthScopeDetailsSchema, (details) => ({
  message: 'This CLI login does not include permission to submit publishing requests.',
  hint: 'Reauthorize the login for this registry, then try publishing again.',
  facts: (details.missingScopes ?? ['publishing.request.create']).map((scope) => ({
    kind: 'missing-capability' as const,
    value: oauthScopeLabel(scope),
  })),
  resources: ['login'],
}));

const packageOwnerNotAuthorizedSpec = defineSpec(requestedOwnerDetailsSchema, (details, context) => {
  const owner =
    details.requestedOwnerOrganizationName ?? details.ownerOrganizationName ?? safeOwner(context.requestedOwner);
  const allowedOwners = details.allowedOwnerOrganizationNames ?? [];
  const scoped = scopedOwner(context.packageName);
  const retryOwner = allowedOwners.length === 1 && !scoped ? allowedOwners[0] : undefined;
  return {
    message: owner
      ? `Your account is not allowed to create this package for UAPKG organization "${owner}".`
      : 'Your account is not allowed to create this package for the requested UAPKG organization.',
    hint: scoped
      ? allowedOwners.length > 0
        ? 'This package’s `@owner` scope determines ownership. Rebuild it under one of the allowed UAPKG organization scopes shown above.'
        : 'This package’s `@owner` scope determines ownership. Rebuild it under a UAPKG organization scope where you can publish, or ask an organization administrator to grant access.'
      : retryOwner
        ? `Retry with \`--owner ${retryOwner}\` to use the allowed UAPKG organization namespace.`
        : allowedOwners.length > 0
          ? 'Choose one of the allowed UAPKG organization namespaces with `--owner`, or ask a UAPKG organization administrator to grant access.'
          : 'Choose a UAPKG organization namespace where you can publish, or ask a UAPKG organization administrator to grant access.',
    facts: compactFacts([
      fact('requested-owner', owner),
      ...allowedOwners.map((allowedOwner) => fact('allowed-owner', allowedOwner)),
    ]),
  };
});

const publishingAuthorityDeniedSpec = defineSpec(emptyDetailsSchema, (_details, context) => {
  switch (context.credentialKind) {
    case 'oidc':
      return {
        message: 'This GitHub Actions workflow does not currently have publishing authority for the package.',
        hint: 'Check the package’s trusted-publisher repository, workflow, and optional GitHub Environment setting, then run the workflow again.',
        resources: ['trusted-publishers'],
      };
    case 'gat':
      return {
        message: 'This granular access token does not currently have publishing authority for the package.',
        hint: 'Create or use a token for the package owner with the required package access and publishing permission.',
        resources: ['access-tokens'],
      };
    case 'login':
      return {
        message: 'Your account does not currently have publishing authority for the package.',
        hint: 'Choose an owner organization where you can publish, or ask an organization administrator to grant access.',
      };
  }
});

const tokenResourceAccessSpec = defineSpec(tokenAccessDetailsSchema, (details) => {
  const actualPackageMode = details.actualPackageAccessMode ?? details.packageAccess?.mode;
  const actualRegistryMode = details.actualRegistryAccessMode ?? details.registryAccess?.mode;
  const requiredPackageModes = details.requiredPackageAccessModes;
  const requiredRegistryModes = details.requiredRegistryAccessModes;
  return {
    message: 'This token does not cover the package or registry selected for publication.',
    hint: 'Create or use a token whose package and registry access cover this publication.',
    facts: compactFacts([
      fact('actual-access-mode', accessModeLabel(actualPackageMode, 'package')),
      fact('actual-access-mode', accessModeLabel(actualRegistryMode, 'registry')),
      fact('required-access-mode', accessModesLabel(requiredPackageModes, 'package')),
      fact('required-access-mode', accessModesLabel(requiredRegistryModes, 'registry')),
    ]),
    resources: ['access-tokens'],
  };
});

const oidcRepositorySpec = defineSpec(oidcRepositoryDetailsSchema, (details, context) => {
  const submitted = details.submittedRepository ?? safeRepository(context.repository);
  const trusted = details.trustedRepository;
  if (!trusted) {
    return {
      message: 'The registry could not determine the trusted repository for this workflow session.',
      hint: 'Start a new trusted-publishing workflow and try again. If the failure continues, review the trusted-publisher rule and report the server code.',
      facts: compactFacts([fact('requested-repository', submitted)]),
      resources: ['trusted-publishers'],
    };
  }
  return {
    message: submitted
      ? `This workflow submitted "${submitted}", but its trusted-publisher rule is bound to "${trusted}".`
      : 'The registry could not compare the package source with this workflow’s trusted-publisher rule.',
    hint: submitted
      ? 'Publish from the repository named by the trusted-publisher rule, or update the rule for the intended package source.'
      : 'Start a new trusted-publishing workflow and try again. If the failure continues, report the server code.',
    facts: compactFacts([fact('requested-repository', submitted), fact('trusted-repository', trusted)]),
    resources: ['trusted-publishers'],
  };
});

const versionConflictSpec = (kind: 'exists' | 'tombstoned') =>
  defineSpec(versionDetailsSchema, (_details, context) => {
    const coordinate = packageCoordinate(context);
    return kind === 'exists'
      ? {
          message: `${coordinate} is already published in this registry.`,
          hint: 'Choose a new version in uapkg.json, rebuild the archive, and publish that version instead.',
          resources: ['requests'],
        }
      : {
          message: `${coordinate} was previously unpublished and cannot be reused.`,
          hint: 'Choose a new version in uapkg.json, rebuild the archive, and publish that version instead.',
          resources: ['requests'],
        };
  });

const activeRequestSpec = (ownershipConflict: boolean) =>
  defineSpec(activeRequestDetailsSchema, (details, context) => {
    const coordinate = packageCoordinate(context);
    const readableRequestId = ownershipConflict ? undefined : details.activeRequestId;
    return {
      message: ownershipConflict
        ? `Another organization already has an active first-publication request for ${safePackageLabel(context.packageName)}.`
        : `An active publishing request already covers ${coordinate}.`,
      hint: ownershipConflict
        ? 'Wait for that request to finish before trying to claim this package name, or review your own request when a request ID is shown.'
        : 'Wait for the active request to finish instead of submitting the same publication again.',
      facts: compactFacts([fact('request-id', readableRequestId)]),
      resources: ['requests'],
      requestId: readableRequestId,
    };
  });

const haltedPackageSpec = defineSpec(haltedPackageDetailsSchema, (details, context) => ({
  message: `Publishing for ${safePackageLabel(context.packageName)} is paused because an earlier request could not be completed.`,
  hint: 'Review the earlier request and ask the registry operator to resolve its failure before publishing again.',
  facts: compactFacts([fact('request-id', details.blockingRequestId)]),
  resources: ['requests'],
  requestId: details.blockingRequestId,
}));

const rateLimitSpec = defineSpec(retryDetailsSchema, (details) => ({
  message: 'Too many publishing requests were submitted in a short time.',
  hint: details.retryAfterSeconds
    ? `Wait ${formatDuration(details.retryAfterSeconds)}, then try publishing again.`
    : 'Wait a moment, then try publishing again.',
  facts: compactFacts([
    fact('retry-after', details.retryAfterSeconds ? formatDuration(details.retryAfterSeconds) : undefined),
  ]),
}));

/**
 * Explicit inventory of errors that can be returned synchronously while the
 * CLI submits POST /v1/registry-requests/publish. Unknown future codes use the
 * non-leaking fallback in {@link publishRequestDiagnosticForError}.
 */
export const PUBLISH_SUBMISSION_ERROR_CATALOG = {
  // Authentication and request-bound authorization.
  AUTH_REQUIRED: loginSpec('Authentication is required to publish this package.'),
  CONTROL_PLANE_AUTHENTICATION_REQUIRED: loginSpec('The saved registry login was rejected.'),
  DPOP_AUTH_UNAVAILABLE: internalServiceSpec('The registry cannot validate CLI logins right now.'),
  DPOP_AUTH_REQUIRED: loginSpec('The publishing request did not include a valid CLI login.'),
  DPOP_PROOF_INVALID: loginSpec('The saved CLI login proof was rejected.'),
  DPOP_PROOF_REPLAYED: fixedSpec(
    'The security proof for this CLI login was already used.',
    'Run the publish command again. If the failure continues, sign in to the selected registry again.',
    ['login'],
  ),
  DPOP_ACCESS_TOKEN_INVALID: loginSpec('The saved CLI login is invalid or no longer usable.'),
  DPOP_PROOF_STALE: fixedSpec(
    'The security proof for this CLI login expired before the request arrived.',
    'Run the publish command again. If the failure continues, sign in to the selected registry again.',
    ['login'],
  ),
  DPOP_NONCE_REQUIRED: fixedSpec(
    'The registry could not complete the security challenge for this CLI login.',
    'Run the publish command again. If the failure continues, sign in to the selected registry again.',
    ['login'],
  ),
  REGISTRY_GRANT_INVALID: loginSpec('The registry login was revoked, expired, or belongs to another registry.'),
  CLI_LOGIN_ACTIVATION_EXPIRED: loginSpec('This CLI login expired before the device finished confirming it.'),
  ACCOUNT_NOT_ACTIVE: loginSpec('The account for this registry login is not active.'),
  CLI_ACCESS_TOKEN_INVALID: loginSpec('The saved CLI login is invalid.'),
  CLI_ACCESS_TOKEN_EXPIRED: loginSpec('The saved CLI login has expired.'),
  OAUTH_SCOPE_INSUFFICIENT: oauthScopeSpec,
  OAUTH_SCOPE_UNSUPPORTED: fixedSpec(
    'This CLI version does not understand a capability required by the registry.',
    'Update UAPKG CLI, sign in again, and retry the publication.',
    ['login'],
  ),
  TOKEN_INVALID: tokenSpec('The selected granular access token is invalid.'),
  TOKEN_REVOKED: tokenSpec('The selected granular access token has been revoked.'),
  TOKEN_EXPIRED: tokenSpec('The selected granular access token has expired.'),
  UAPKG_TOKEN_APPROVAL_PENDING: fixedSpec(
    'The selected token is still waiting for organization approval.',
    'Ask an organization administrator to approve the token, or select a different active token.',
    ['access-tokens'],
  ),
  UAPKG_TOKEN_APPROVAL_DENIED: fixedSpec(
    'The organization denied the selected token request.',
    'Use an approved token, or request a new token from the organization.',
    ['access-tokens'],
  ),
  UAPKG_TOKEN_ORGANIZATION_POLICY_DENIED: fixedSpec(
    'The organization’s token policy blocks this publication.',
    'Ask an organization administrator to review the token policy, or publish with an allowed credential.',
    ['access-tokens'],
  ),
  UAPKG_TOKEN_TEMPORARILY_BLOCKED_OWNER_MFA_REQUIRED: fixedSpec(
    'This token is temporarily blocked because its owner must enable two-factor authentication.',
    'Enable two-factor authentication for the token owner, then try again.',
    ['access-tokens', 'security'],
  ),
  UAPKG_TOKEN_LIFECYCLE_DISABLED: tokenSpec('The selected token is not currently usable.'),
  UAPKG_TOKEN_PERMISSION_DENIED: tokenPermissionSpec,
  UAPKG_TOKEN_RESOURCE_ACCESS_DENIED: tokenResourceAccessSpec,
  SECOND_FACTOR_REQUIRED: fixedSpec(
    'A current two-factor authentication code is required for this publication.',
    'Run the publish command again and enter the current code when prompted.',
    ['security'],
  ),
  OTP_INVALID: fixedSpec(
    'The two-factor authentication code was incorrect or expired.',
    'Run the publish command again and enter a new code when prompted.',
    ['security'],
  ),
  OTP_NOT_ENROLLED: fixedSpec(
    'This account must enroll in two-factor authentication before publishing.',
    'Enable two-factor authentication in account settings, then try publishing again.',
    ['security'],
  ),
  OTP_RATE_LIMITED: rateLimitSpec,
  OTP_ERROR: internalServiceSpec('The registry could not verify the two-factor authentication code.'),
  OTP_UNSUPPORTED_PRINCIPAL: fixedSpec(
    'This credential cannot use an interactive two-factor authentication code.',
    'Select a CLI login or granular access token that supports attended publication.',
  ),
  SECURED_ACCOUNT_REQUIRED: fixedSpec(
    'Publishing requires an active account with two-factor authentication enabled.',
    'Activate the account and enable two-factor authentication, then try again.',
    ['security'],
  ),
  ACTOR_WRITE_FORBIDDEN: fixedSpec(
    'This account is not allowed to submit registry changes.',
    'Use an account with publishing access, or ask an organization administrator for access.',
  ),
  UAPKG_PRINCIPAL_NOT_ALLOWED: fixedSpec(
    'This kind of credential cannot submit a publishing request.',
    'Use a CLI login, granular access token, or configured GitHub Actions trusted publisher.',
  ),

  // Ownership, package naming, and token access.
  UNSCOPED_PACKAGE_OWNER_REQUIRED: unscopedOwnerSpec,
  GAT_OWNER_ORGANIZATION_MISMATCH: gatOwnerMismatchSpec,
  UAPKG_PACKAGE_SCOPE_OWNER_MISMATCH: scopeMismatchSpec,
  UAPKG_REGISTRY_REQUIRES_SCOPED_PACKAGE: defineSpec(packageDetailsSchema, (_details, context) => ({
    message: `This registry requires a scoped name for the first publication of ${safePackageLabel(context.packageName)}.`,
    hint: 'Rename the package to `@organization/name`, rebuild the archive, and publish it again.',
  })),
  INITIAL_PUBLICATION_PACKAGE_ACCESS_ALL_REQUIRED: initialTokenAccessSpec,
  PACKAGE_OWNER_NOT_AUTHORIZED: packageOwnerNotAuthorizedSpec,
  INITIAL_PUBLICATION_CREDENTIAL_UNSUPPORTED: fixedSpec(
    'This credential cannot create a package during its first publication.',
    'Publish the package once with an interactive CLI login or an attended granular access token.',
    ['login', 'access-tokens'],
  ),
  CLI_REGISTRY_GRANT_NOT_AUTHORIZED: fixedSpec(
    'The saved CLI login cannot publish to this registry.',
    'Reauthorize the login for the selected registry, then try again.',
    ['login'],
  ),
  REGISTRY_WRITE_DENIED_REBAC: publishingAuthorityDeniedSpec,
  GAT_CREDENTIAL_CONTEXT_REQUIRED: internalServiceSpec('The registry could not validate the selected token.'),
  PACKAGE_OWNER_NOT_RESOLVED: internalServiceSpec('The registry could not determine this package’s owner.'),

  // GitHub Actions trusted publishing.
  OIDC_SESSION_INVALID: fixedSpec(
    'The GitHub Actions publishing session expired or is no longer trusted.',
    'Run the workflow again. If it still fails, verify that the trusted-publisher rule and repository connection are active.',
    ['trusted-publishers'],
  ),
  OIDC_PROVIDER_UNAVAILABLE: fixedSpec(
    'The registry cannot validate GitHub trusted publishing right now.',
    'Run the workflow again later. If the failure continues, report the server code to the registry operator.',
    ['trusted-publishers'],
  ),
  OIDC_INITIAL_PUBLICATION_NOT_SUPPORTED: fixedSpec(
    'GitHub Actions cannot create this package during its first publication.',
    'Publish the package once with an interactive CLI login, then configure its trusted-publisher rule and rerun the workflow.',
    ['login', 'trusted-publishers'],
  ),
  OIDC_SOURCE_REPOSITORY_MISMATCH: oidcRepositorySpec,
  TRUSTED_PUBLISHER_NOT_AUTHORIZED: fixedSpec(
    'This GitHub Actions workflow is not authorized to publish the package.',
    'Check the package’s trusted-publisher repository, workflow, and optional GitHub Environment setting, then rerun the workflow.',
    ['trusted-publishers'],
  ),

  // Archive, source, claims, and request-contract validation.
  INVALID_PACKAGE_NAME: fixedSpec(
    'The packaged manifest contains an invalid package name.',
    'Set `name` in uapkg.json to a name such as `my-package` or `@organization/my-package`, rebuild the archive, and publish it again.',
  ),
  SCOPED_PACKAGES_DISABLED: fixedSpec(
    'The selected registry does not accept organization-scoped package names.',
    'Select a registry that supports scoped packages, or intentionally rename and rebuild the package as an unscoped package with an explicit owner.',
    ['registries', 'owner-command'],
  ),
  INVALID_VERSION: fixedSpec(
    'The packaged manifest contains an invalid semantic version.',
    'Set `version` in uapkg.json to a semantic version such as `1.2.3`, rebuild the archive, and publish it again.',
  ),
  INVALID_OWNER_ORGANIZATION_NAME: fixedSpec(
    'The selected owner is not a valid organization name.',
    'Correct `--owner <organization>` or `publish.owner` in uapkg.json, then try publishing again.',
    ['owner-command'],
  ),
  SOURCE_REQUIRED: fixedSpec(
    'The publishing request did not identify its GitHub Release source.',
    'Set `publish.repository` or pass `--repository owner/repository`, and make sure the release tag and asset exist before retrying.',
  ),
  GITHUB_RELEASE_SOURCE_REQUIRED: fixedSpec(
    'The publishing request did not identify its GitHub Release source.',
    'Set `publish.repository` or pass `--repository owner/repository`, and make sure the release tag and asset exist before retrying.',
  ),
  SOURCE_TYPE_UNSUPPORTED: fixedSpec(
    'The registry does not support this kind of package source.',
    'Publish from an uploaded GitHub Release asset. If this CLI produced another source type, update it and try again.',
  ),
  GITHUB_REPOSITORY_INVALID: fixedSpec(
    'The publishing request contains an invalid GitHub repository coordinate.',
    'Pass `--repository owner/repository` or correct `publish.repository` in uapkg.json, then try again.',
  ),
  RELEASE_TAG_INVALID: fixedSpec(
    'The publishing request contains an invalid GitHub Release tag.',
    'Pass a non-empty GitHub Release tag with `--tag <tag>`, or correct the package version used by the default tag.',
  ),
  RELEASE_ASSET_NAME_INVALID: fixedSpec(
    'The publishing request contains an invalid GitHub Release asset name.',
    'Pass the uploaded file name—not a path—with `--asset <file-name>`, then try again.',
  ),
  OBSERVED_INTEGRITY_REQUIRED: fixedSpec(
    'The publishing request is missing the archive’s integrity information.',
    'Re-read or rebuild the archive and try again. If the problem remains, update UAPKG CLI and report the server code.',
  ),
  OBSERVED_DIGEST_INVALID: fixedSpec(
    'The publishing request contains an invalid archive digest.',
    'Re-read or rebuild the archive and try again. If the problem remains, update UAPKG CLI and report the server code.',
  ),
  OBSERVED_SIZE_INVALID: fixedSpec(
    'The publishing request contains an invalid archive size.',
    'Re-read or rebuild the archive and try again. If the problem remains, update UAPKG CLI and report the server code.',
  ),
  CLAIMS_REQUIRED: fixedSpec(
    'The publishing request is missing package information from the packaged manifest.',
    'Rebuild the archive so it contains a valid uapkg.json, then publish the rebuilt file.',
  ),
  CLAIMS_IDENTITY_MISMATCH: fixedSpec(
    'The package name or version inside the archive does not match the publication being submitted.',
    'Rebuild the archive from the intended uapkg.json and publish the rebuilt file.',
  ),
  CLAIMS_PRIVATE_INVALID: fixedSpec(
    'The packaged manifest has an invalid private-package setting.',
    'Set `private` in uapkg.json to `true` or `false`, rebuild the archive, and publish it again.',
  ),
  CLAIMS_BUCKET_INVALID: fixedSpec(
    'The packaged manifest has an invalid dependency section.',
    'Make each dependency section in uapkg.json an object, rebuild the archive, and publish it again.',
  ),
  CLAIMS_DEPENDENCIES_TOO_MANY: fixedSpec(
    'A dependency section in the packaged manifest is too large.',
    'Reduce the dependency entries in uapkg.json, rebuild the archive, and publish it again.',
  ),
  CLAIMS_DEPENDENCY_NAME_INVALID: fixedSpec(
    'The packaged manifest contains an invalid dependency name.',
    'Correct the dependency name in uapkg.json, rebuild the archive, and publish it again.',
  ),
  CLAIMS_DEPENDENCY_RANGE_INVALID: fixedSpec(
    'The packaged manifest contains an invalid dependency version range.',
    'Set a non-empty bounded version range for the dependency, rebuild the archive, and publish it again.',
  ),
  CLAIMS_DEPENDENCY_REGISTRY_INVALID: fixedSpec(
    'The packaged manifest contains an invalid dependency registry.',
    'Correct the dependency registry alias in uapkg.json, rebuild the archive, and publish it again.',
  ),
  CLAIMS_DEPENDENCY_FIELDS_INVALID: fixedSpec(
    'A packaged dependency contains unsupported fields.',
    'Remove unsupported dependency fields from uapkg.json, rebuild the archive, and publish it again.',
  ),
  OFFICIAL_REGISTRY_PRIVATE_PACKAGE_FORBIDDEN: fixedSpec(
    'This package is marked private, but the selected registry accepts only public packages.',
    'Publish to a private registry, or intentionally remove the private setting, rebuild the archive, and try again.',
    ['registries'],
  ),
  SERVER_RESOLVED_METADATA_NOT_ALLOWED: clientRequestSpec('The publishing request contains server-owned metadata.'),
  UNRECOGNIZED_REQUEST_FIELDS: clientRequestSpec(
    'The publishing request contains fields this registry does not recognize.',
  ),
  INVALID_REGISTRY_ID: clientRequestSpec('The CLI resolved an invalid registry identity.'),
  PAYLOAD_TOO_LARGE: fixedSpec(
    'The packaged publication information is too large for this registry.',
    'Reduce oversized manifest metadata or dependency entries, rebuild the archive, and try again.',
  ),
  REQUEST_BODY_TOO_LARGE: fixedSpec(
    'The publishing request is too large for this registry.',
    'Reduce oversized manifest metadata or dependency entries, rebuild the archive, and try again.',
  ),
  UAPKG_OPERATION_INPUT_TOO_LARGE: fixedSpec(
    'The publishing request is too large for this registry.',
    'Reduce oversized manifest metadata or dependency entries, rebuild the archive, and try again.',
  ),
  INVALID_CONTENT_LENGTH: clientRequestSpec('The registry received an incomplete publishing request.'),
  INVALID_JSON: clientRequestSpec('The registry could not read the publishing request.'),
  INVALID_REQUEST_BODY: clientRequestSpec('The registry could not understand the publishing request.'),
  UAPKG_OPERATION_INPUT_INVALID: clientRequestSpec('The registry could not understand the publishing request.'),
  IDEMPOTENCY_KEY_REQUIRED: clientRequestSpec('The publishing request was missing its retry-safety key.'),
  REQUEST_KIND_NOT_PUBLIC: internalServiceSpec('The CLI reached the wrong registry operation.'),
  SOURCE_NOT_ALLOWED: internalServiceSpec('The CLI reached the wrong registry operation for an artifact publication.'),
  REASON_REQUIRED: internalServiceSpec('The CLI reached an operation that requires a reason.'),
  DEPRECATION_MESSAGE_REQUIRED: internalServiceSpec(
    'The CLI reached an operation that requires a deprecation message.',
  ),

  // Registry readiness, versions, and concurrent requests.
  REGISTRY_NOT_FOUND: fixedSpec(
    'The selected registry is no longer available to the publishing service.',
    'Refresh or reconfigure the registry, then try publishing again.',
    ['registries'],
  ),
  REGISTRY_LINK_MISSING: fixedSpec(
    'The selected registry is not connected to an initialized repository.',
    'Finish the registry repository connection in account settings, then try publishing again.',
    ['registries'],
  ),
  REGISTRY_LINK_NOT_READY: fixedSpec(
    'The selected registry repository connection is incomplete.',
    'Finish reconnecting the registry repository in account settings, then try publishing again.',
    ['registries'],
  ),
  PACKAGE_POLICY_NOT_CONFIGURED: internalServiceSpec(
    'The registry is not ready to assign ownership for a new package.',
  ),
  PACKAGE_NOT_FOUND: fixedSpec(
    'The package does not exist in the selected registry.',
    'Check the package and registry, then try again.',
    ['registries'],
  ),
  PACKAGE_HALTED: haltedPackageSpec,
  VERSION_ALREADY_EXISTS: versionConflictSpec('exists'),
  VERSION_TOMBSTONED: versionConflictSpec('tombstoned'),
  DUPLICATE_ACTIVE_REQUEST: activeRequestSpec(false),
  PACKAGE_OWNERSHIP_PENDING_CONFLICT: activeRequestSpec(true),
  IDEMPOTENCY_KEY_CONFLICT: fixedSpec(
    'The retry-safety key for this publication is already attached to a different request.',
    'Run the publication again. If the conflict continues, report the server code to the registry operator.',
    ['requests'],
  ),
  RATE_LIMIT_EXCEEDED: rateLimitSpec,

  // Defensive catalog entries for invalid route state and server failures.
  REQUEST_ATTRIBUTION_INVALID: internalServiceSpec('The registry could not safely attribute this publishing request.'),
  AUTHORIZATION_RECEIPT_REQUIRED: internalServiceSpec(
    'The registry could not preserve authorization for this request.',
  ),
  REQUEST_CREATE_FAILED: internalServiceSpec('The registry could not save the publishing request.'),
  OPERATION_AUTHORIZATION_ACTION_MISMATCH: internalServiceSpec('The publishing endpoint is misconfigured.'),
  OPERATION_BODY_LIMIT_UNREGISTERED: internalServiceSpec('The publishing endpoint is missing its request-size policy.'),
  UAPKG_OPERATION_BINDING_MISMATCH: internalServiceSpec('The publishing endpoint is bound incorrectly.'),
  UAPKG_OPERATION_BINDER_MISMATCH: internalServiceSpec(
    'The publishing endpoint uses the wrong authentication boundary.',
  ),
  UAPKG_OPERATION_BODY_LIMIT_UNREGISTERED: internalServiceSpec(
    'The publishing endpoint is missing its request-size policy.',
  ),
  UAPKG_SERVICE_AUTHENTICATION_REQUIRED: internalServiceSpec(
    'The publishing endpoint rejected an unsupported credential.',
  ),
  REGISTRY_REQUEST_RESPONSE_INVALID: internalServiceSpec('The registry returned an invalid publishing response.'),
  CONTROL_PLANE_RESPONSE_NOT_JSON: internalServiceSpec('The registry returned an unreadable publishing response.'),

  // These normally belong to lifecycle routes, but cataloging them keeps a
  // misrouted publish response helpful and non-leaking.
  DESTRUCTIVE_POLICY_NOT_CONFIGURED: internalServiceSpec('The registry’s version policy is not configured.'),
  PACKAGE_VERSION_TARGET_NOT_FOUND: fixedSpec(
    'The selected package version does not exist in the registry.',
    'Check the package version and selected registry.',
    ['requests'],
  ),
  VERSION_ALREADY_UNPUBLISHED: fixedSpec(
    'This package version is already unpublished.',
    'No further action is needed.',
  ),
  VERSION_ALREADY_YANKED: fixedSpec('This package version is already yanked.', 'No further action is needed.'),
  VERSION_NOT_YANKED: fixedSpec(
    'This package version is not yanked.',
    'Check the current request state before trying again.',
  ),
  VERSION_ALREADY_DEPRECATED: fixedSpec('This package version is already deprecated.', 'No further action is needed.'),
  VERSION_NOT_DEPRECATED: fixedSpec(
    'This package version is not deprecated.',
    'Check the current request state before trying again.',
  ),
  UNPUBLISH_WINDOW_EXPIRED: fixedSpec(
    'The allowed time window for unpublishing this version has closed.',
    'Contact the registry operator if the version presents a security or legal issue.',
  ),
} as const satisfies Record<string, PublishErrorSpec>;

export type PublishSubmissionErrorCode = keyof typeof PUBLISH_SUBMISSION_ERROR_CATALOG;

export function publishRequestDiagnosticForError(
  error: unknown,
  context: PublishRequestErrorContext,
): PublishRequestFailedDiagnostic {
  const serverCode = validatedServerCode(error);
  const status = validatedStatus(error);
  const spec = serverCode
    ? (PUBLISH_SUBMISSION_ERROR_CATALOG as Record<string, PublishErrorSpec>)[serverCode]
    : undefined;
  const guidance = spec
    ? spec.build(error instanceof ControlPlaneError ? error.details : undefined, context)
    : fallback(error, status);
  const facts = dedupeFacts([...baseFacts(context), ...(guidance.facts ?? [])]);
  const resources = resourcesFor(guidance.resources ?? [], context, guidance.requestId);

  return createPublishRequestFailedDiagnostic(
    guidance.message,
    {
      ...(serverCode ? { serverCode } : {}),
      ...(status !== undefined ? { status } : {}),
      facts,
      resources,
    },
    guidance.hint,
  );
}

function fallback(error: unknown, status: number | undefined): PublishGuidance {
  if (isNetworkFailure(error)) {
    return {
      message: 'UAPKG could not reach the publishing service.',
      hint: 'Check the network connection and registry availability, then try publishing again.',
    };
  }
  if (status !== undefined && status >= 500) {
    return {
      message: 'The publishing service could not complete the request.',
      hint: RETRY_AND_REPORT,
    };
  }
  return {
    message: 'The registry did not accept the publishing request.',
    hint: 'Review the publication details and try again. If the failure continues, report this diagnostic to the registry operator.',
  };
}

function baseFacts(context: PublishRequestErrorContext): PublishDiagnosticFact[] {
  const registryName = safeDisplayValue(context.registryName ?? '', 100);
  const registryAlias = safeDisplayValue(context.registryAlias, 100);
  const registry =
    registryName && registryAlias && registryName !== registryAlias
      ? `${registryName} (${registryAlias})`
      : (registryName ?? registryAlias);
  return compactFacts([
    fact('package', safeDisplayValue(context.packageName, 214)),
    fact('version', safeDisplayValue(context.packageVersion, 256)),
    fact('registry', registry),
    fact('credential-kind', credentialKindLabel(context.credentialKind)),
    fact('requested-owner', safeOwner(context.requestedOwner)),
    fact('repository', safeRepository(context.repository)),
  ]);
}

function resourcesFor(
  requested: readonly ResourceKind[],
  context: PublishRequestErrorContext,
  requestId?: string,
): PublishDiagnosticResource[] {
  const kinds = [...new Set([...requested, 'help' as const])];
  const accountOrigin = accountOriginForIssuer(context.registryIssuer);
  const resources: PublishDiagnosticResource[] = [];
  for (const kind of kinds) {
    switch (kind) {
      case 'help':
        resources.push({ kind: 'command', command: 'uapkg publish --help', label: 'Publish command help' });
        break;
      case 'login':
        resources.push({
          kind: 'command',
          command: `uapkg login --registry ${shellDisplayArgument(context.registryAlias)} --reauthorize`,
          label: 'Reauthorize this registry login',
        });
        break;
      case 'owner-command':
        resources.push({
          kind: 'command',
          command: 'uapkg publish --owner <organization>',
          label: 'Publish with an explicit owner',
        });
        break;
      case 'requests':
        if (requestId) {
          resources.push({
            kind: 'command',
            command: `uapkg requests status ${requestId}`,
            label: 'Inspect the related request',
          });
        }
        addAccountUrl(resources, accountOrigin, '/requests', 'Publishing requests');
        break;
      case 'access-tokens':
        addAccountUrl(resources, accountOrigin, '/settings/access-tokens', 'Access token settings');
        break;
      case 'trusted-publishers':
        addAccountUrl(resources, accountOrigin, '/trusted-publishers', 'Trusted publishers');
        break;
      case 'registries':
        addAccountUrl(resources, accountOrigin, '/settings/registries', 'Registry settings');
        break;
      case 'security':
        addAccountUrl(
          resources,
          accountOrigin,
          '/settings/two-factor-authentication',
          'Two-factor authentication settings',
        );
        break;
    }
  }
  return dedupeResources(resources);
}

function addAccountUrl(
  resources: PublishDiagnosticResource[],
  origin: string | undefined,
  path: string,
  label: string,
): void {
  if (!origin) return;
  resources.push({ kind: 'url', url: new URL(path, origin).href, label });
}

function accountOriginForIssuer(issuer: string): string | undefined {
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function validatedServerCode(error: unknown): string | undefined {
  return error instanceof ControlPlaneError && SERVER_CODE_PATTERN.test(error.code) ? error.code : undefined;
}

function validatedStatus(error: unknown): number | undefined {
  if (!(error instanceof ControlPlaneError) || error.status === undefined) return undefined;
  return Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
}

function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

function safeDisplayValue(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength && !hasUnsafeDisplayCharacter(normalized)
    ? normalized
    : undefined;
}

function hasUnsafeDisplayCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f ||
        (codePoint >= 0x7f && codePoint <= 0x9f) ||
        codePoint === 0x061c ||
        codePoint === 0x200e ||
        codePoint === 0x200f ||
        (codePoint >= 0x2028 && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
}

function safeOwner(value: unknown): string | undefined {
  const parsed = ownerNameSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safeRepository(value: unknown): string | undefined {
  const parsed = repositorySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function safePackageLabel(packageName: string): string {
  const safe = safeDisplayValue(packageName, 214);
  return safe ? `"${safe}"` : 'this package';
}

function packageCoordinate(context: PublishRequestErrorContext): string {
  const packageName = safeDisplayValue(context.packageName, 214);
  const version = safeDisplayValue(context.packageVersion, 256);
  return packageName && version ? `"${packageName}@${version}"` : 'This package version';
}

function scopedOwner(packageName: string): string | undefined {
  const match = safeDisplayValue(packageName, 214)?.match(/^@([^/]+)\//u);
  return safeOwner(match?.[1]);
}

function credentialKindLabel(kind: PublishRequestErrorContext['credentialKind']): string {
  switch (kind) {
    case 'login':
      return 'CLI login';
    case 'gat':
      return 'Granular access token';
    case 'oidc':
      return 'GitHub Actions trusted publishing';
  }
}

function capabilityLabel(capability: z.output<typeof missingCapabilitiesSchema>[number]): string {
  return capability === 'package.publish' ? 'Publish packages' : 'Submit publishing requests';
}

function oauthScopeLabel(scope: z.output<typeof missingOAuthScopesSchema>[number]): string {
  return scope === 'publishing.request.create' ? 'Submit publishing requests' : 'Read your publishing requests';
}

function accessModeLabel(
  mode: z.output<typeof accessModeSchema> | undefined,
  category: 'package' | 'registry',
): string | undefined {
  if (!mode) return undefined;
  const noun = category === 'package' ? 'packages' : 'registries';
  switch (mode) {
    case 'none':
      return `No ${noun}`;
    case 'selected':
      return `Selected ${noun}`;
    case 'all':
      return `All ${noun}`;
  }
}

function accessModesLabel(
  modes: readonly ('selected' | 'all')[] | undefined,
  category: 'package' | 'registry',
): string | undefined {
  if (!modes || modes.length === 0) return undefined;
  const labels = [...new Set(modes)].map((mode) => accessModeLabel(mode, category)).filter(Boolean);
  return labels.join(' or ');
}

function formatDuration(seconds: number): string {
  if (seconds === 1) return '1 second';
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }
  return `${seconds} seconds`;
}

function quotedList(values: readonly string[]): string {
  const quoted = values.map((value) => `"${value}"`);
  if (quoted.length === 1) return quoted[0] as string;
  if (quoted.length === 2) return `${quoted[0]} or ${quoted[1]}`;
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted.at(-1)}`;
}

function fact(kind: PublishDiagnosticFact['kind'], value: string | undefined): PublishDiagnosticFact | undefined {
  return value ? { kind, value } : undefined;
}

function compactFacts(facts: readonly (PublishDiagnosticFact | undefined)[]): PublishDiagnosticFact[] {
  return facts.filter((value): value is PublishDiagnosticFact => value !== undefined);
}

function dedupeFacts(facts: readonly PublishDiagnosticFact[]): PublishDiagnosticFact[] {
  const seen = new Set<string>();
  return facts.filter((factValue) => {
    const key = `${factValue.kind}\0${factValue.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeResources(resources: readonly PublishDiagnosticResource[]): PublishDiagnosticResource[] {
  const seen = new Set<string>();
  return resources.filter((resource) => {
    const key = resource.kind === 'command' ? `command\0${resource.command}` : `url\0${resource.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shellDisplayArgument(value: string): string {
  const safe = safeDisplayValue(value, 100);
  return safe && /^[A-Za-z0-9._-]+$/u.test(safe) ? safe : '<registry>';
}
