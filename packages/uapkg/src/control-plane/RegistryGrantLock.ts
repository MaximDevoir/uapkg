import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, unlink, utimes } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_FILE_VERSION = 1;
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const DEFAULT_STALE_AFTER_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;

interface LockOwner {
  readonly version: typeof LOCK_FILE_VERSION;
  readonly ownerId: string;
  readonly pid: number;
  readonly acquiredAt: number;
}

export interface RegistryGrantLock {
  withLock<T>(issuer: string, registryId: string, operation: () => Promise<T>): Promise<T>;
}

export interface FileRegistryGrantLockOptions {
  readonly waitTimeoutMs?: number;
  readonly staleAfterMs?: number;
  readonly pollIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly isProcessAlive?: (pid: number) => boolean;
}

/**
 * Cross-process serialization for a registry grant's rotating refresh-token
 * family. Lock file names contain only a SHA-256 digest of the issuer and
 * registry ID; lock contents contain only an opaque owner ID, PID, and time.
 */
export class FileRegistryGrantLock implements RegistryGrantLock {
  private readonly waitTimeoutMs: number;
  private readonly staleAfterMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly isProcessAlive: (pid: number) => boolean;

  public constructor(
    private readonly directory: string,
    options: FileRegistryGrantLockOptions = {},
  ) {
    this.waitTimeoutMs = positiveMilliseconds(options.waitTimeoutMs, DEFAULT_WAIT_TIMEOUT_MS);
    this.staleAfterMs = positiveMilliseconds(options.staleAfterMs, DEFAULT_STALE_AFTER_MS);
    this.pollIntervalMs = positiveMilliseconds(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.heartbeatIntervalMs = positiveMilliseconds(
      options.heartbeatIntervalMs,
      Math.min(DEFAULT_HEARTBEAT_INTERVAL_MS, Math.max(1, Math.floor(this.staleAfterMs / 3))),
    );
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? delay;
    this.isProcessAlive = options.isProcessAlive ?? processIsAlive;
  }

  public pathFor(issuer: string, registryId: string): string {
    const digest = createHash('sha256')
      .update(`${issuer.replace(/\/+$/, '')}\0${registryId.toLowerCase()}`)
      .digest('hex');
    return join(this.directory, `${digest}.lock`);
  }

  public async withLock<T>(issuer: string, registryId: string, operation: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const lockPath = this.pathFor(issuer, registryId);
    const owner: LockOwner = {
      version: LOCK_FILE_VERSION,
      ownerId: randomUUID(),
      pid: process.pid,
      acquiredAt: this.now(),
    };
    const deadline = this.now() + this.waitTimeoutMs;

    while (!(await this.tryAcquire(lockPath, owner))) {
      if (await this.reclaimIfStale(lockPath)) continue;
      const remaining = deadline - this.now();
      if (remaining <= 0) {
        throw new Error(
          'Timed out waiting for another UAPKG process to finish using the saved login for this registry.',
        );
      }
      await this.sleep(Math.min(this.pollIntervalMs, remaining));
    }

    const heartbeat = setInterval(() => {
      void this.touchIfOwned(lockPath, owner.ownerId);
    }, this.heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      return await operation();
    } finally {
      clearInterval(heartbeat);
      await this.releaseIfOwned(lockPath, owner.ownerId);
    }
  }

  private async tryAcquire(lockPath: string, owner: LockOwner): Promise<boolean> {
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') return false;
      throw new Error('Unable to create the UAPKG registry-grant lock.', { cause: error });
    }

    try {
      await handle.writeFile(JSON.stringify(owner), { encoding: 'utf8' });
      return true;
    } catch (error) {
      await unlink(lockPath).catch(() => undefined);
      throw new Error('Unable to initialize the UAPKG registry-grant lock.', { cause: error });
    } finally {
      await handle.close();
    }
  }

  private async reclaimIfStale(lockPath: string): Promise<boolean> {
    let lockStat: Awaited<ReturnType<typeof stat>>;
    try {
      lockStat = await stat(lockPath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return true;
      throw new Error('Unable to inspect the UAPKG registry-grant lock.', { cause: error });
    }

    const observedOwner = await readOwner(lockPath);
    if (observedOwner) {
      // A valid owner record with a definitely dead PID is safe to reclaim
      // immediately. Waiting for the general stale threshold would make a
      // refresh retry miss the authorization server's bounded predecessor
      // grace after a process dies between rotation and local persistence.
      if (this.isProcessAlive(observedOwner.pid)) return false;
    } else if (this.now() - lockStat.mtimeMs <= this.staleAfterMs) {
      // A just-created lock can briefly be empty while its owner record is
      // written. Malformed or unreadable ownership therefore remains subject
      // to the conservative stale threshold.
      return false;
    }

    const quarantinePath = `${lockPath}.stale-${randomUUID()}`;
    try {
      await rename(lockPath, quarantinePath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return true;
      throw new Error('Unable to quarantine a stale UAPKG registry-grant lock.', { cause: error });
    }

    const movedOwner = await readOwner(quarantinePath);
    if (observedOwner && movedOwner?.ownerId !== observedOwner.ownerId) {
      await rename(quarantinePath, lockPath).catch(() => undefined);
      return false;
    }

    await unlink(quarantinePath).catch((error: unknown) => {
      throw new Error('Unable to remove a stale UAPKG registry-grant lock.', { cause: error });
    });
    return true;
  }

  private async touchIfOwned(lockPath: string, ownerId: string): Promise<void> {
    const owner = await readOwner(lockPath);
    if (owner?.ownerId !== ownerId) return;
    const now = new Date(this.now());
    await utimes(lockPath, now, now).catch(() => undefined);
  }

  private async releaseIfOwned(lockPath: string, ownerId: string): Promise<void> {
    const owner = await readOwner(lockPath);
    if (!owner) return;
    if (owner.ownerId !== ownerId) {
      throw new Error('The UAPKG registry-grant lock changed ownership before it could be released.');
    }
    try {
      await unlink(lockPath);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      throw new Error('Unable to release the UAPKG registry-grant lock.', { cause: error });
    }
  }
}

async function readOwner(lockPath: string): Promise<LockOwner | undefined> {
  try {
    const value = JSON.parse(await readFile(lockPath, 'utf8')) as unknown;
    if (
      typeof value !== 'object' ||
      value === null ||
      (value as Partial<LockOwner>).version !== LOCK_FILE_VERSION ||
      typeof (value as Partial<LockOwner>).ownerId !== 'string' ||
      !Number.isInteger((value as Partial<LockOwner>).pid) ||
      typeof (value as Partial<LockOwner>).acquiredAt !== 'number'
    ) {
      return undefined;
    }
    return value as LockOwner;
  } catch {
    return undefined;
  }
}

function processIsAlive(pid: number): boolean {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

function positiveMilliseconds(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
