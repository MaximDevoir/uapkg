import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeUrl } from '@uapkg/common';
import { getRegistryRepoPath } from '@uapkg/registry-core';
import { z } from 'zod';
import type { CompositionRoot } from '../app/CompositionRoot.js';
import {
  type RegistryTrust,
  registryAudience,
  UAPKG_AUTHORIZATION_ISSUER,
  UAPKG_CONTROL_PLANE_API,
} from './ControlPlaneTypes.js';

const registryMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    registry: z.object({
      id: z.uuid(),
      name: z.string().min(1),
      identifier: z.string().min(1),
    }),
    sourceOfTruth: z.object({
      type: z.literal('uapkg-service'),
      // Advisory only. The CLI deliberately does not use this URL.
      apiBaseUrl: z.string().optional(),
    }),
  })
  .passthrough();

export class RegistryTrustResolver {
  public constructor(private readonly root: CompositionRoot) {}

  public async resolve(requestedAlias?: string): Promise<RegistryTrust> {
    const alias = requestedAlias ?? this.selectedAlias();
    const result = this.root.registryCore.getOrCreateRegistry(alias);
    if (!result.ok) {
      throw new Error(firstDiagnostic(result.diagnostics, `Registry "${alias}" is not configured.`));
    }

    const registry = result.value;
    const updated = await registry.ensureUpToDate({
      logicalRegistryName: alias,
      bypassFreshnessCheck: true,
    });
    if (!updated.ok || updated.value === 'Failed') {
      throw new Error(firstDiagnostic(updated.diagnostics, `Unable to update registry "${alias}".`));
    }

    const metadataPath = join(getRegistryRepoPath(registry.shortId), '.uapkg', 'registry.meta.json');
    let raw: string;
    try {
      raw = await readFile(metadataPath, 'utf8');
    } catch (error) {
      throw new Error(
        `Registry "${alias}" does not contain .uapkg/registry.meta.json. It cannot be used for authenticated control-plane commands.`,
        { cause: error },
      );
    }

    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Registry metadata for "${alias}" is not valid JSON.`, { cause: error });
    }
    const parsed = registryMetaSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(`Registry metadata for "${alias}" does not match the supported schema.`);
    }

    const repositoryUrl = canonicalizeRegistryGitOrigin(registry.descriptor.url);
    return {
      alias,
      registryId: parsed.data.registry.id,
      registryName: parsed.data.registry.name,
      registryIdentifier: parsed.data.registry.identifier,
      repositoryUrl,
      repositoryFingerprint: fingerprintRegistryGitOrigin(repositoryUrl),
      issuer: UAPKG_AUTHORIZATION_ISSUER,
      apiBaseUrl: UAPKG_CONTROL_PLANE_API,
      resource: registryAudience(parsed.data.registry.id),
      cacheShortId: registry.shortId,
    };
  }

  public async forceRefresh(trust: RegistryTrust): Promise<void> {
    const result = this.root.registryCore.getOrCreateRegistry(trust.alias);
    if (!result.ok) {
      throw new Error(firstDiagnostic(result.diagnostics, `Registry "${trust.alias}" is not configured.`));
    }
    const updated = await result.value.ensureUpToDate({
      logicalRegistryName: trust.alias,
      bypassFreshnessCheck: true,
    });
    if (!updated.ok || updated.value === 'Failed') {
      throw new Error(firstDiagnostic(updated.diagnostics, `Unable to refresh registry "${trust.alias}".`));
    }
  }

  private selectedAlias(): string {
    const selected = this.root.config.get('registry');
    if (typeof selected !== 'string' || selected.trim().length === 0) {
      throw new Error('No registry is selected. Configure one with `uapkg registry use <name>`.');
    }
    return selected;
  }
}

/**
 * GitHub accepts HTTPS, SSH URL, and SCP-like clone coordinates for the same
 * repository. Control-plane authorization must bind all three spellings to one
 * stable source identity.
 */
export function canonicalizeRegistryGitOrigin(origin: string): string {
  const value = origin.trim();
  const scpLike = /^(?:git@)?github\.com:([^/\s]+)\/([^/\s]+?)\/?$/i.exec(value);
  if (scpLike) {
    return canonicalGitHubRepository(scpLike[1], scpLike[2]);
  }

  try {
    const parsed = new URL(value);
    if (parsed.hostname.toLowerCase() === 'github.com') {
      const path = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
      if (path.length !== 2) {
        throw new Error('A GitHub registry origin must identify exactly one owner and repository.');
      }
      return canonicalGitHubRepository(path[0], path[1]);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('A GitHub registry origin')) {
      throw error;
    }
  }

  return normalizeUrl(value);
}

export function fingerprintRegistryGitOrigin(origin: string): string {
  const canonical = canonicalizeRegistryGitOrigin(origin);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function canonicalGitHubRepository(owner: string, repository: string): string {
  const normalizedOwner = owner.trim().toLowerCase();
  const normalizedRepository = repository
    .trim()
    .replace(/\.git$/i, '')
    .toLowerCase();
  if (!normalizedOwner || !normalizedRepository) {
    throw new Error('A GitHub registry origin must include an owner and repository.');
  }
  return `https://github.com/${normalizedOwner}/${normalizedRepository}.git`;
}

function firstDiagnostic(diagnostics: readonly { readonly message: string }[], fallback: string): string {
  return diagnostics[0]?.message ?? fallback;
}
