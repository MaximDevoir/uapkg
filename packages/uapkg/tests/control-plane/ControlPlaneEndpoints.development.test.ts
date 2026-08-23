import { describe, expect, it, vi } from 'vite-plus/test';

vi.mock('../../src/build/BuildMetadata.js', () => ({
  UAPKG_BUILD_METADATA: Object.freeze({
    mode: 'development',
    packageVersion: '1.2.3',
    displayVersion: '1.2.3-development-mode',
  }),
}));

import { ControlPlaneClient } from '../../src/control-plane/ControlPlaneClient.js';
import {
  registryAudience,
  UAPKG_AUTHORIZATION_ISSUER,
  UAPKG_CONTROL_PLANE_API,
} from '../../src/control-plane/ControlPlaneTypes.js';

describe('development-stamped control-plane endpoints', () => {
  it('pins authorization, API requests, and registry audiences to development', async () => {
    expect(UAPKG_AUTHORIZATION_ISSUER).toBe('https://account-dev.uapkg.dev/oauth');
    expect(UAPKG_CONTROL_PLANE_API).toBe('https://api-dev.uapkg.dev');
    expect(registryAudience('00000000-0000-4000-a000-000000000020')).toBe(
      'https://api-dev.uapkg.dev/v1/registries/00000000-0000-4000-a000-000000000020',
    );

    const fetchMock = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      new ControlPlaneClient().getSelf({ kind: 'bearer', accessToken: 'test-access-token' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SELF_RESPONSE_INVALID' });
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://api-dev.uapkg.dev/v1/account/self'), expect.any(Object));
    expect(() => new ControlPlaneClient('https://api.uapkg.dev')).toThrow('pinned to https://api-dev.uapkg.dev');
  });
});
