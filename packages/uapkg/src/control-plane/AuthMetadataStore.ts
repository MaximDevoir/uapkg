import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { resolveAuthStoragePaths } from './AuthStoragePaths.ts';
import type { AuthMetadataFile, RegistryGrantMetadata } from './ControlPlaneTypes.ts';
import { FileRegistryGrantLock, type RegistryGrantLock } from './RegistryGrantLock.ts';

const AUTH_METADATA_LOCK_NAMESPACE = 'urn:uapkg:auth-metadata';

const accountSchema = z
  .object({
    id: z.uuid(),
    username: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();

const grantSchema = z
  .object({
    issuer: z.url(),
    registryId: z.uuid(),
    registryName: z.string().min(1),
    grantId: z.uuid(),
    clientId: z.string().min(1),
    keyReference: z.string().min(1),
    refreshTokenReference: z.string().min(1),
    publicKeyThumbprint: z.string().min(1),
    deviceName: z.string().min(1),
    repositoryFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    account: accountSchema,
    createdAt: z.number().int().nonnegative(),
    idleExpiresAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    grants: z.record(z.string(), grantSchema),
  })
  .strict();

export class AuthMetadataStore {
  private readonly mutationLock: RegistryGrantLock;

  public constructor(
    private readonly filePath = resolveAuthStoragePaths().metadataFile,
    mutationLock?: RegistryGrantLock,
  ) {
    this.mutationLock = mutationLock ?? new FileRegistryGrantLock(resolveAuthStoragePaths(filePath).locksDirectory);
  }

  public get path(): string {
    return this.filePath;
  }

  public async find(issuer: string, registryId: string): Promise<RegistryGrantMetadata | undefined> {
    return (await this.read()).grants[grantKey(issuer, registryId)];
  }

  public async upsert(metadata: RegistryGrantMetadata): Promise<void> {
    await this.withMutationLock(async () => {
      const current = await this.read();
      await this.write({
        schemaVersion: 1,
        grants: {
          ...current.grants,
          [grantKey(metadata.issuer, metadata.registryId)]: metadata,
        },
      });
    });
  }

  public async remove(issuer: string, registryId: string): Promise<void> {
    await this.withMutationLock(async () => {
      const current = await this.read();
      const key = grantKey(issuer, registryId);
      if (!(key in current.grants)) return;
      const next = { ...current.grants };
      delete next[key];
      await this.write({ schemaVersion: 1, grants: next });
    });
  }

  private async read(): Promise<AuthMetadataFile> {
    if (!existsSync(this.filePath)) {
      return { schemaVersion: 1, grants: {} };
    }

    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      throw new Error(`Unable to read saved UAPKG login metadata at ${this.filePath}.`, { cause: error });
    }

    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(
        `Saved UAPKG login metadata at ${this.filePath} is not valid JSON. Move it aside and run \`uapkg login\` again.`,
        { cause: error },
      );
    }

    const parsed = fileSchema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `Saved UAPKG login metadata at ${this.filePath} is invalid. Move it aside and run \`uapkg login\` again.`,
      );
    }
    return parsed.data;
  }

  private async write(value: AuthMetadataFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationLock.withLock(AUTH_METADATA_LOCK_NAMESPACE, resolve(this.filePath), operation);
  }
}

function grantKey(issuer: string, registryId: string): string {
  return `${issuer.replace(/\/+$/, '')}|${registryId.toLowerCase()}`;
}
