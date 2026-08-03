import * as oauth from 'oauth4webapi';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient, type ControlPlaneCredential } from '../../src/control-plane/ControlPlaneClient.js';
import { UAPKG_CONTROL_PLANE_API } from '../../src/control-plane/ControlPlaneTypes.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ControlPlaneClient CLI login confirmation', () => {
  it('validates preparation and activation responses over DPoP', async () => {
    const grantId = '22222222-2222-4222-8222-222222222222';
    const predecessorGrantId = '11111111-1111-4111-8111-111111111111';
    const now = Date.now();
    const requests: Array<{ readonly url: string; readonly method: string; readonly authorization: string | null }> =
      [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          method: init?.method ?? 'GET',
          authorization: headers.get('authorization'),
        });
        expect(headers.get('dpop')).toBeTruthy();
        if (init?.method === 'GET') {
          return Response.json({
            ok: true,
            account: { id: 'account-1', username: 'maxim' },
            registry: { id: '00000000-0000-4000-a000-000000000020' },
            grant: {
              id: grantId,
              status: 'pending',
              deviceName: 'workstation',
              idleExpiresAt: new Date(now + 86_400_000).toISOString(),
              absoluteExpiresAt: new Date(now + 172_800_000).toISOString(),
              activationExpiresAt: new Date(now + 60_000).toISOString(),
              replacesGrantId: predecessorGrantId,
              scopes: ['identity.self.read'],
            },
          });
        }
        return Response.json({
          ok: true,
          grant: { id: grantId, status: 'active', replacesGrantId: predecessorGrantId },
        });
      }),
    );
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential();

    await expect(client.getCliLoginConfirmation(credential)).resolves.toMatchObject({
      grant: {
        id: grantId,
        status: 'pending',
        activationExpiresAt: expect.any(String),
        replacesGrantId: predecessorGrantId,
      },
    });
    await expect(client.confirmCliLogin(credential)).resolves.toEqual({
      id: grantId,
      status: 'active',
      replacesGrantId: predecessorGrantId,
    });

    expect(requests).toEqual([
      {
        url: `${UAPKG_CONTROL_PLANE_API}/v1/account/cli-login/confirmation`,
        method: 'GET',
        authorization: 'DPoP access-token',
      },
      {
        url: `${UAPKG_CONTROL_PLANE_API}/v1/account/cli-login/confirmation`,
        method: 'POST',
        authorization: 'DPoP access-token',
      },
    ]);
  });

  it('rejects a missing replacement binding and a non-active confirmation response', async () => {
    const grantId = '22222222-2222-4222-8222-222222222222';
    const now = Date.now();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'GET') {
        return Response.json({
          ok: true,
          account: { id: 'account-1' },
          registry: { id: '00000000-0000-4000-a000-000000000020' },
          grant: {
            id: grantId,
            status: 'pending',
            deviceName: 'workstation',
            idleExpiresAt: new Date(now + 86_400_000).toISOString(),
            absoluteExpiresAt: new Date(now + 172_800_000).toISOString(),
            activationExpiresAt: new Date(now + 60_000).toISOString(),
            scopes: ['identity.self.read'],
          },
        });
      }
      return Response.json({ ok: true, grant: { id: grantId, status: 'pending', replacesGrantId: null } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new ControlPlaneClient(UAPKG_CONTROL_PLANE_API);
    const credential = await dpopCredential();

    await expect(client.getCliLoginConfirmation(credential)).rejects.toMatchObject({
      code: 'CLI_LOGIN_CONFIRMATION_RESPONSE_INVALID',
    });
    await expect(client.confirmCliLogin(credential)).rejects.toMatchObject({
      code: 'CLI_LOGIN_CONFIRMATION_RESPONSE_INVALID',
    });
  });
});

async function dpopCredential(): Promise<ControlPlaneCredential> {
  const pair = await oauth.generateKeyPair('ES256');
  return {
    kind: 'dpop',
    accessToken: 'access-token',
    dpop: oauth.DPoP({}, pair),
  };
}
