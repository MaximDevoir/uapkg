import { describe, expect, it } from 'vite-plus/test';
import { CredentialStore } from '../../src/control-plane/CredentialStore.ts';

describe('CredentialStore', () => {
  it('loads the native keyring lazily and never uses a plaintext fallback', async () => {
    const values = new Map<string, string>();
    let loads = 0;
    const store = new CredentialStore(async () => {
      loads += 1;
      return {
        Entry: class {
          public constructor(
            _service: string,
            private readonly username: string,
          ) {}

          public setPassword(value: string): void {
            values.set(this.username, value);
          }

          public getPassword(): string | null {
            return values.get(this.username) ?? null;
          }

          public deleteCredential(): boolean {
            return values.delete(this.username);
          }
        },
      };
    });

    expect(loads).toBe(0);
    await store.set('grant:test', 'secret');
    expect(loads).toBe(1);
    await expect(store.get('grant:test')).resolves.toBe('secret');
    await store.delete('grant:test');
    await expect(store.get('grant:test')).resolves.toBeUndefined();
    expect(loads).toBe(1);
  });

  it('fails closed when protected storage cannot be loaded', async () => {
    const store = new CredentialStore(async () => {
      throw new Error('native backend missing');
    });
    await expect(store.assertAvailable()).rejects.toThrow('Secure operating-system credential storage is unavailable');
  });

  it('generates stable, opaque references without embedding registry or issuer text', () => {
    const store = new CredentialStore();
    const a = store.createReference('grant', 'https://account.uapkg.dev/oauth', 'registry-id', 'grant-id');
    const b = store.createReference('grant', 'https://account.uapkg.dev/oauth', 'registry-id', 'grant-id');
    expect(a).toBe(b);
    expect(a).toMatch(/^grant:[0-9a-f]{64}$/);
    expect(a).not.toContain('registry-id');
  });
});
