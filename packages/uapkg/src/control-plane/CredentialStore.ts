import { createHash, randomUUID } from 'node:crypto';

interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deleteCredential(): boolean;
}

interface KeyringModule {
  Entry: new (service: string, username: string) => KeyringEntry;
}

export type KeyringLoader = () => Promise<KeyringModule>;

/**
 * Protected secret storage. The native module is imported only when a
 * control-plane command needs it, so install/search/update remain portable.
 */
export class CredentialStore {
  private module?: KeyringModule;

  public constructor(
    private readonly loadKeyring: KeyringLoader = async () => (await import('@napi-rs/keyring')) as KeyringModule,
    private readonly service = 'uapkg.cli',
  ) {}

  public async assertAvailable(): Promise<void> {
    const reference = `availability:${randomUUID()}`;
    try {
      await this.set(reference, reference);
      const roundTrip = await this.get(reference);
      if (roundTrip !== reference) {
        throw new Error('The operating-system credential store failed a round-trip check.');
      }
    } catch (error) {
      throw new Error(
        'Secure operating-system credential storage is unavailable. UAPKG will not save login secrets in plaintext.',
        { cause: error },
      );
    } finally {
      await this.delete(reference).catch(() => undefined);
    }
  }

  public async get(reference: string): Promise<string | undefined> {
    await this.ensureModule();
    try {
      return this.entry(reference).getPassword() ?? undefined;
    } catch (error) {
      if (isMissingCredentialError(error)) return undefined;
      throw new Error('Unable to read a UAPKG credential from protected operating-system storage.', {
        cause: error,
      });
    }
  }

  public async set(reference: string, value: string): Promise<void> {
    await this.ensureModule();
    try {
      this.entry(reference).setPassword(value);
    } catch (error) {
      throw new Error('Unable to save a UAPKG credential in protected operating-system storage.', {
        cause: error,
      });
    }
  }

  public async delete(reference: string): Promise<void> {
    await this.ensureModule();
    try {
      this.entry(reference).deleteCredential();
    } catch (error) {
      if (!isMissingCredentialError(error)) {
        throw new Error('Unable to remove a UAPKG credential from protected operating-system storage.', {
          cause: error,
        });
      }
    }
  }

  public createReference(kind: 'grant' | 'dpop-key', issuer: string, registryId: string, grantId: string): string {
    const digest = createHash('sha256')
      .update(`${kind}\0${issuer.replace(/\/+$/, '')}\0${registryId.toLowerCase()}\0${grantId}`)
      .digest('hex');
    return `${kind}:${digest}`;
  }

  private entry(reference: string): KeyringEntry {
    if (!this.module) {
      throw new Error('CredentialStore has not loaded the native keyring yet.');
    }
    return new this.module.Entry(this.service, reference);
  }

  private async ensureModule(): Promise<void> {
    this.module ??= await this.loadKeyring();
  }
}

function isMissingCredentialError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no\s*entry|not\s*found|missing/i.test(message);
}
