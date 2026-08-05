import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { readPackageClaimsFromArchive } from '@uapkg/package-claims';
import { getRegistryRepoPath } from '@uapkg/registry-core';
import type { CompositionRoot } from '../app/CompositionRoot.js';
import type { UAPKGOutputFormat } from '../cli/UAPKGCommandLine.js';
import { describeControlPlaneError } from '../control-plane/AccountManager.js';
import { ArtifactObserver } from '../control-plane/ArtifactObserver.js';
import { AuthenticationSelector } from '../control-plane/AuthenticationSelector.js';
import { ControlPlaneClient } from '../control-plane/ControlPlaneClient.js';
import {
  type ControlPlaneAuthMode,
  ControlPlaneError,
  type RegistryRequestStatus,
  type RegistryRequestSubmission,
} from '../control-plane/ControlPlaneTypes.js';
import { PublishIdempotencyStore } from '../control-plane/PublishIdempotencyStore.js';
import { InkPromptService } from '../prompts/InkPromptService.js';
import type { Command } from './Command.js';

const execFileAsync = promisify(execFile);
const TERMINAL_STATUSES = new Set<RegistryRequestStatus>([
  'ready',
  'ready_superseded',
  'rejected',
  'operationally_failed',
]);
const SUCCESS_STATUSES = new Set<RegistryRequestStatus>(['ready', 'ready_superseded']);
const PUBLISH_WATCH_TIMEOUT_MS = 30 * 60 * 1000;

export interface PublishCommandOptions {
  readonly registry?: string;
  readonly owner?: string;
  readonly repository?: string;
  readonly tag?: string;
  readonly asset?: string;
  readonly assetPath?: string;
  readonly auth: ControlPlaneAuthMode;
  readonly detach: boolean;
  readonly outputFormat: UAPKGOutputFormat;
}

/**
 * Artifact-first publish (PS-REQ-002): the CLI observes the exact release
 * artifact (download or `--asset-path`), reads packaged claims from it, and
 * submits the route-derived publish operation. The packaged archive — never
 * the working tree — is what gets published.
 */
export class PublishCommand implements Command {
  public constructor(
    private readonly root: CompositionRoot,
    private readonly options: PublishCommandOptions,
  ) {}

  public async execute(): Promise<number> {
    try {
      const manifestResult = await this.root.packageManifest.readManifest();
      if (!manifestResult.ok) {
        throw new Error(manifestResult.diagnostics[0]?.message ?? 'Unable to read uapkg.json.');
      }
      const manifest = manifestResult.value;

      const registryAlias = this.options.registry ?? manifest.publish?.registry;
      const trust = await this.root.registryTrustResolver.resolve(registryAlias);
      const source = await this.resolveSource(manifest.version, manifest.publish);

      const observer = new ArtifactObserver();
      const artifact = this.options.assetPath
        ? await observer.observeLocalArchive(resolveAssetPath(this.root.cwd, this.options.assetPath))
        : await observer.downloadReleaseAsset(source.repository, source.releaseTag, source.assetName);

      try {
        const claimsResult = await readPackageClaimsFromArchive(artifact.archivePath);
        if (!claimsResult.ok) {
          throw new Error(
            claimsResult.diagnostics[0]?.message ?? 'Unable to read the packaged uapkg.json from the artifact.',
          );
        }
        const claims = claimsResult.value;
        if (
          this.options.outputFormat === 'text' &&
          (claims.name !== manifest.name || claims.version !== manifest.version)
        ) {
          process.stderr.write(
            `Publishing ${claims.name}@${claims.version} from the packaged artifact (local manifest says ${manifest.name}@${manifest.version}).\n`,
          );
        }

        const registryType = await readTrustedRegistryType(trust.cacheShortId);
        if (registryType === 'public' && claims.private) {
          throw new Error(
            `"${claims.name}" is marked private in its packaged manifest; a public UAPKG registry does not accept private packages.`,
          );
        }

        const scopedOwner = scopedOwnerName(claims.name);
        const configuredOwner = normalizeOwner(this.options.owner ?? manifest.publish?.owner);
        if (scopedOwner && configuredOwner && configuredOwner.toLowerCase() !== scopedOwner.toLowerCase()) {
          throw new Error(
            `Package "${claims.name}" belongs to the "${scopedOwner}" namespace; --owner cannot select "${configuredOwner}".`,
          );
        }
        const owner = scopedOwner ?? configuredOwner;

        const selector = new AuthenticationSelector(this.root.accountManager, new InkPromptService());
        const requestedScopes = this.options.detach
          ? (['publishing.request.create'] as const)
          : (['publishing.request.create', 'publishing.request.read.self'] as const);
        let authentication = await selector.select(this.options.auth, trust, requestedScopes, true);

        const submission: RegistryRequestSubmission = {
          registryId: trust.registryId,
          ...(owner ? { ownerOrganizationName: owner } : {}),
          payload: {
            packageName: claims.name,
            packageVersion: claims.version,
            source,
            observedIntegrity: { sha256: artifact.sha256, sizeBytes: artifact.sizeBytes },
            claims,
          },
        };

        const idempotencyStore = new PublishIdempotencyStore();
        const submissionDigest = PublishIdempotencyStore.submissionDigest('publish', submission);
        const idempotencyKey = idempotencyStore.getOrCreate(submissionDigest, () => randomUUID());

        const client = new ControlPlaneClient(trust.apiBaseUrl);
        const created = await client.submitRegistryRequest(authentication.credential, 'publish', submission, {
          idempotencyKey,
          otp: authentication.otp,
        });
        if (this.options.detach) {
          this.printCreated(created.requestId, created.status, trust.alias);
          return 0;
        }

        let request = await client.getRegistryRequest(authentication.credential, created.requestId);
        let previousStatus = '';
        const deadline = Date.now() + PUBLISH_WATCH_TIMEOUT_MS;
        while (!TERMINAL_STATUSES.has(request.status)) {
          if (Date.now() >= deadline) {
            throw new Error(
              `Timed out waiting for publishing request ${request.id}. Check it with \`uapkg requests status ${request.id}\`.`,
            );
          }
          if (this.options.outputFormat === 'text' && request.status !== previousStatus) {
            process.stdout.write(
              `${request.id}: ${request.status}${request.currentStep ? ` (${request.currentStep})` : ''}\n`,
            );
            previousStatus = request.status;
          }
          await delay(2_000);
          try {
            request = await client.getRegistryRequest(authentication.credential, created.requestId);
          } catch (error) {
            if (!(error instanceof ControlPlaneError) || error.status !== 401) throw error;
            if (authentication.kind === 'gat') throw error;
            if (authentication.kind === 'login') {
              this.root.accountManager.invalidateAccessCredentials(trust);
            }
            authentication = await selector.select(authentication.kind, trust, ['publishing.request.read.self'], false);
            request = await client.getRegistryRequest(authentication.credential, created.requestId);
          }
        }

        idempotencyStore.clear(submissionDigest);

        if (SUCCESS_STATUSES.has(request.status)) {
          let refreshWarning: string | undefined;
          try {
            await this.root.registryTrustResolver.forceRefresh(trust);
          } catch (error) {
            refreshWarning = error instanceof Error ? error.message : String(error);
          }
          this.printTerminal(request, trust.alias, refreshWarning);
          return 0;
        }

        this.printTerminal(request, trust.alias);
        return 1;
      } finally {
        await artifact.cleanup();
      }
    } catch (error) {
      process.stderr.write(`${describeControlPlaneError(error)}\n`);
      return 1;
    }
  }

  private async resolveSource(
    packageVersion: string,
    manifestPublish:
      | {
          readonly repository?: string;
          readonly asset?: string;
        }
      | undefined,
  ) {
    const repository = normalizeGitHubRepository(
      this.options.repository ?? manifestPublish?.repository ?? (await this.gitOrigin()),
    );
    const releaseTag = (this.options.tag ?? `v${packageVersion}`).trim();
    const assetName = (this.options.asset ?? manifestPublish?.asset ?? 'package.tgz').trim();
    if (!releaseTag) throw new Error('The GitHub Release tag cannot be empty.');
    if (!assetName || assetName.includes('/') || assetName.includes('\\')) {
      throw new Error('The GitHub Release asset must be a file name, not a path.');
    }
    return {
      type: 'github_release' as const,
      repository,
      releaseTag,
      assetName,
    };
  }

  private async gitOrigin(): Promise<string> {
    const git = (this.root.config.get('git') as string | null) ?? 'git';
    try {
      const { stdout } = await execFileAsync(git, ['remote', 'get-url', 'origin'], {
        cwd: this.root.cwd,
        timeout: 10_000,
      });
      return stdout.trim();
    } catch (error) {
      throw new Error('Unable to derive the GitHub repository from remote "origin". Use --repository.', {
        cause: error,
      });
    }
  }

  private printCreated(requestId: string, status: RegistryRequestStatus, registryAlias: string): void {
    if (this.options.outputFormat === 'json') {
      process.stdout.write(`${JSON.stringify({ ok: true, registry: registryAlias, requestId, status })}\n`);
      return;
    }
    process.stdout.write(`Publishing request ${requestId} submitted to "${registryAlias}" (${status}).\n`);
  }

  private printTerminal(
    request: { id: string; status: RegistryRequestStatus; currentStep?: string },
    registryAlias: string,
    refreshWarning?: string,
  ): void {
    if (this.options.outputFormat === 'json') {
      process.stdout.write(
        `${JSON.stringify({
          ok: SUCCESS_STATUSES.has(request.status),
          registry: registryAlias,
          request,
          ...(refreshWarning ? { registryRefreshWarning: refreshWarning } : {}),
        })}\n`,
      );
      return;
    }
    process.stdout.write(`Publishing request ${request.id}: ${request.status}.\n`);
    if (request.status === 'ready_superseded') {
      process.stdout.write('The publication was accepted; a newer change to the same package is already projected.\n');
    }
    if (refreshWarning) {
      process.stderr.write(`Package publication succeeded, but the local registry refresh failed: ${refreshWarning}\n`);
    }
  }
}

/** Reads the installer-trusted registry type from the projected registry snapshot. */
async function readTrustedRegistryType(cacheShortId: string): Promise<'public' | 'private' | undefined> {
  const metaPath = join(getRegistryRepoPath(cacheShortId), '.uapkg', 'registry.meta.json');
  if (!existsSync(metaPath)) return undefined;
  try {
    const raw = await readFile(metaPath, 'utf8');
    const parsed = JSON.parse(raw) as { registry?: { registryType?: unknown } };
    const value = parsed.registry?.registryType;
    return value === 'public' || value === 'private' ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveAssetPath(cwd: string, assetPath: string): string {
  return isAbsolute(assetPath) ? assetPath : join(cwd, assetPath);
}

function normalizeGitHubRepository(input: string): string {
  let value = input.trim();
  const scp = value.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (scp) value = `${scp[1]}/${scp[2]}`;

  if (value.includes('://')) {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'github.com') {
      throw new Error('Publishing sources must be hosted on github.com in UAPKG v1.');
    }
    value = url.pathname.replace(/^\/+/, '');
  }
  value = value.replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('Expected a GitHub repository in owner/repository form.');
  }
  return value.toLowerCase();
}

function scopedOwnerName(packageName: string): string | undefined {
  const match = packageName.match(/^@([^/]+)\/[^/]+$/);
  return match?.[1]?.toLowerCase();
}

function normalizeOwner(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const owner = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(owner)) {
    throw new Error('The publish owner must be a valid UAPKG organization name.');
  }
  return owner;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
