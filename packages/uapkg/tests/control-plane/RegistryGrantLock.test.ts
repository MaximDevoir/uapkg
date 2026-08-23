import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { FileRegistryGrantLock } from '../../src/control-plane/RegistryGrantLock.js';

const issuer = 'https://account.uapkg.dev/oauth';
const registryId = '00000000-0000-4000-a000-000000000020';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'uapkg-grant-lock-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('FileRegistryGrantLock', () => {
  it('keeps only opaque ownership data and always releases after an operation error', async () => {
    const lock = new FileRegistryGrantLock(directory);
    const lockPath = lock.pathFor(issuer, registryId);

    await expect(
      lock.withLock(issuer, registryId, async () => {
        const raw = await readFile(lockPath, 'utf8');
        expect(raw).not.toContain(issuer);
        expect(raw).not.toContain(registryId);
        expect(raw).not.toContain('refresh');
        throw new Error('operation failed');
      }),
    ).rejects.toThrow('operation failed');

    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lock.withLock(issuer, registryId, async () => 'reacquired')).resolves.toBe('reacquired');
  });

  it('reclaims an old lock only after its recorded process is no longer alive', async () => {
    const lock = new FileRegistryGrantLock(directory, {
      staleAfterMs: 10,
      waitTimeoutMs: 250,
      pollIntervalMs: 1,
      isProcessAlive: () => false,
    });
    const lockPath = lock.pathFor(issuer, registryId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'stale-owner',
        pid: 999_999,
        acquiredAt: 1,
      }),
      'utf8',
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    await expect(lock.withLock(issuer, registryId, async () => 'recovered')).resolves.toBe('recovered');
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('immediately reclaims a fresh lock whose recorded owner process crashed', async () => {
    const lock = new FileRegistryGrantLock(directory, {
      staleAfterMs: 120_000,
      waitTimeoutMs: 25,
      pollIntervalMs: 1,
      isProcessAlive: () => false,
    });
    const lockPath = lock.pathFor(issuer, registryId);
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'crashed-owner',
        pid: 999_999,
        acquiredAt: Date.now(),
      }),
      'utf8',
    );

    await expect(lock.withLock(issuer, registryId, async () => 'recovered')).resolves.toBe('recovered');
    await expect(access(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not steal an old-looking lock from a process that is still alive', async () => {
    const lock = new FileRegistryGrantLock(directory, {
      staleAfterMs: 10,
      waitTimeoutMs: 25,
      pollIntervalMs: 2,
      isProcessAlive: () => true,
    });
    const lockPath = lock.pathFor(issuer, registryId);
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        ownerId: 'live-owner',
        pid: process.pid,
        acquiredAt: 1,
      }),
      'utf8',
    );
    const old = new Date(Date.now() - 60_000);
    await utimes(lockPath, old, old);

    await expect(lock.withLock(issuer, registryId, async () => undefined)).rejects.toThrow(
      'Timed out waiting for another UAPKG process',
    );
    await expect(readFile(lockPath, 'utf8')).resolves.toContain('live-owner');
  });
});
