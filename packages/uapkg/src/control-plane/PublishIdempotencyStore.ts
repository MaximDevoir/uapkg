import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveActiveUapkgProfileRoot } from '@uapkg/common';
import { sha256OfCanonicalJson } from '@uapkg/package-claims';

const STORE_FILE_NAME = 'publish-idempotency.json';
const MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredEntry {
  readonly key: string;
  readonly createdAt: number;
}

interface StoreFile {
  readonly schemaVersion: 1;
  readonly entries: Readonly<Record<string, StoredEntry>>;
}

/**
 * Persisted idempotency keys for logical registry-operation submissions.
 * One logical submission (operation + registry + payload) keeps one key
 * across retries, so a re-run after a network fault or crash replays the
 * original request instead of creating a duplicate. Keys are cleared once
 * the request reaches a terminal state.
 */
export class PublishIdempotencyStore {
  private readonly filePath: string;

  public constructor(filePath?: string) {
    this.filePath = filePath ?? join(resolveActiveUapkgProfileRoot(), STORE_FILE_NAME);
  }

  /** Stable digest identifying one logical submission. */
  public static submissionDigest(operation: string, submission: unknown): string {
    return sha256OfCanonicalJson({ operation, submission });
  }

  public getOrCreate(digest: string, newKey: () => string, now = Date.now()): string {
    const store = this.read(now);
    const existing = store.entries[digest];
    if (existing) return existing.key;
    const key = newKey();
    this.write({
      schemaVersion: 1,
      entries: { ...store.entries, [digest]: { key, createdAt: now } },
    });
    return key;
  }

  public clear(digest: string, now = Date.now()): void {
    const store = this.read(now);
    if (!(digest in store.entries)) return;
    const entries = { ...store.entries };
    delete entries[digest];
    this.write({ schemaVersion: 1, entries });
  }

  private read(now: number): StoreFile {
    let parsed: StoreFile | undefined;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const candidate = JSON.parse(raw) as Partial<StoreFile>;
      if (candidate.schemaVersion === 1 && candidate.entries && typeof candidate.entries === 'object') {
        parsed = { schemaVersion: 1, entries: candidate.entries };
      }
    } catch {
      // Missing or corrupt store starts fresh; keys are best-effort retry aids.
    }
    const entries: Record<string, StoredEntry> = {};
    for (const [digest, entry] of Object.entries(parsed?.entries ?? {})) {
      if (
        entry &&
        typeof entry.key === 'string' &&
        typeof entry.createdAt === 'number' &&
        now - entry.createdAt <= MAX_ENTRY_AGE_MS
      ) {
        entries[digest] = entry;
      }
    }
    return { schemaVersion: 1, entries };
  }

  private write(store: StoreFile): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  }
}
