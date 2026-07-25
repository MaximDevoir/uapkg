import { webcrypto } from 'node:crypto';
import type * as oauth from 'oauth4webapi';
import type { CredentialStore } from './CredentialStore.js';

interface SerializedDPoPKeyPair {
  readonly algorithm: 'ES256';
  readonly publicKey: webcrypto.JsonWebKey;
  readonly privateKey: webcrypto.JsonWebKey;
}

export class DPoPKeyStore {
  public constructor(private readonly credentials: CredentialStore) {}

  public async generate(): Promise<oauth.CryptoKeyPair> {
    const { generateKeyPair } = await import('oauth4webapi');
    return generateKeyPair('ES256', { extractable: true });
  }

  public async save(reference: string, pair: oauth.CryptoKeyPair): Promise<void> {
    const [publicKey, privateKey] = await Promise.all([
      webcrypto.subtle.exportKey('jwk', pair.publicKey),
      webcrypto.subtle.exportKey('jwk', pair.privateKey),
    ]);
    const serialized: SerializedDPoPKeyPair = {
      algorithm: 'ES256',
      publicKey,
      privateKey,
    };
    await this.credentials.set(reference, JSON.stringify(serialized));
  }

  public async load(reference: string): Promise<oauth.CryptoKeyPair | undefined> {
    const raw = await this.credentials.get(reference);
    if (!raw) return undefined;

    let saved: SerializedDPoPKeyPair;
    try {
      saved = JSON.parse(raw) as SerializedDPoPKeyPair;
    } catch (error) {
      throw new Error('The saved UAPKG DPoP key is not valid JSON.', { cause: error });
    }
    if (saved.algorithm !== 'ES256' || !saved.publicKey || !saved.privateKey) {
      throw new Error('The saved UAPKG DPoP key has an unsupported format.');
    }

    const algorithm: webcrypto.EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };
    const [publicKey, privateKey] = await Promise.all([
      webcrypto.subtle.importKey('jwk', saved.publicKey, algorithm, true, ['verify']),
      webcrypto.subtle.importKey('jwk', saved.privateKey, algorithm, true, ['sign']),
    ]);
    const challenge = webcrypto.getRandomValues(new Uint8Array(32));
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, challenge);
    const matches = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, challenge);
    if (!matches) {
      throw new Error('The saved UAPKG DPoP public and private keys do not match.');
    }
    return { publicKey, privateKey } as oauth.CryptoKeyPair;
  }

  public async delete(reference: string): Promise<void> {
    await this.credentials.delete(reference);
  }
}
