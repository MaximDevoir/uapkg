import { createHash } from 'node:crypto';
import * as oauth from 'oauth4webapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountManager } from '../../src/control-plane/AccountManager.js';
import { ControlPlaneClient } from '../../src/control-plane/ControlPlaneClient.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('control-plane DPoP requests', () => {
  it('requires the authoritative server-issued registry grant id from account/self', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          ok: true,
          account: {
            id: '20000000-0000-4000-a000-000000000020',
            username: 'maxim',
            displayName: 'Maxim Devoir',
          },
          registry: { id: '00000000-0000-4000-a000-000000000020' },
          grant: {
            deviceName: 'workstation',
            scopes: ['identity.self.read'],
          },
        }),
      ),
    );

    await expect(
      new ControlPlaneClient('https://api.uapkg.dev').getSelf({
        kind: 'bearer',
        accessToken: 'test-token',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SELF_RESPONSE_INVALID' });
  });

  it('retries a resource request once with the server-issued nonce', async () => {
    const pair = await oauth.generateKeyPair('ES256', { extractable: true });
    const dpop = oauth.DPoP({}, pair);
    const accessToken = 'access-token';
    const proofs: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const proof = new Headers(init?.headers).get('dpop');
      if (!proof) throw new Error('missing DPoP proof');
      proofs.push(proof);
      if (proofs.length === 1) {
        return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
          status: 401,
          headers: {
            'content-type': 'application/json',
            'dpop-nonce': 'server-nonce',
            'www-authenticate': 'DPoP error="use_dpop_nonce"',
          },
        });
      }
      return Response.json({
        ok: true,
        account: {
          id: '20000000-0000-4000-a000-000000000020',
          username: 'maxim',
          displayName: 'Maxim Devoir',
        },
        registry: { id: '00000000-0000-4000-a000-000000000020' },
        grant: {
          id: '10000000-0000-4000-a000-000000000020',
          deviceName: 'workstation',
          idleExpiresAt: '2027-01-01T00:00:00.000Z',
          absoluteExpiresAt: '2027-06-01T00:00:00.000Z',
          scopes: ['identity.self.read'],
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new ControlPlaneClient('https://api.uapkg.dev').getSelf({
        kind: 'dpop',
        accessToken,
        dpop,
        registryAlias: 'official',
        requestedScopes: ['identity.self.read'],
      }),
    ).resolves.toMatchObject({ grant: { id: '10000000-0000-4000-a000-000000000020' } });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = decodeJwtPayload(proofs[0]);
    const second = decodeJwtPayload(proofs[1]);
    expect(first).toMatchObject({
      htm: 'GET',
      htu: 'https://api.uapkg.dev/v1/account/self',
      ath: createHash('sha256').update(accessToken).digest('base64url'),
    });
    expect(first).not.toHaveProperty('nonce');
    expect(second).toMatchObject({ nonce: 'server-nonce' });
    expect(second.jti).not.toBe(first.jti);
  });

  it('sender-constrains refresh-token revocation and retries a DPoP nonce challenge', async () => {
    const pair = await oauth.generateKeyPair('ES256', { extractable: true });
    const client: oauth.Client = { client_id: 'uapkg-cli', token_endpoint_auth_method: 'none' };
    const dpop = oauth.DPoP(client, pair);
    const proofs: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const proof = headers.get('dpop');
      if (!proof) throw new Error('missing DPoP proof');
      proofs.push(proof);
      expect(String(init?.body)).toContain('token=refresh-token');
      if (proofs.length === 1) {
        return new Response(JSON.stringify({ error: 'use_dpop_nonce' }), {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'dpop-nonce': 'revocation-nonce',
          },
        });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new AccountManager();
    const revoker = manager as unknown as {
      revokeToken(
        as: oauth.AuthorizationServer,
        client: oauth.Client,
        refreshToken: string,
        dpop: oauth.DPoPHandle,
      ): Promise<void>;
    };
    await revoker.revokeToken(
      {
        issuer: 'https://account.uapkg.dev/oauth',
        revocation_endpoint: 'https://account.uapkg.dev/oauth/revocation',
      },
      client,
      'refresh-token',
      dpop,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = decodeJwtPayload(proofs[0]);
    const second = decodeJwtPayload(proofs[1]);
    expect(first).toMatchObject({
      htm: 'POST',
      htu: 'https://account.uapkg.dev/oauth/revocation',
    });
    expect(first).not.toHaveProperty('ath');
    expect(second).toMatchObject({ nonce: 'revocation-nonce' });
    expect(second.jti).not.toBe(first.jti);
  });
});

function decodeJwtPayload(jwt: string | undefined): Record<string, unknown> {
  if (!jwt) throw new Error('missing JWT');
  const payload = jwt.split('.')[1];
  if (!payload) throw new Error('missing JWT payload');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}
