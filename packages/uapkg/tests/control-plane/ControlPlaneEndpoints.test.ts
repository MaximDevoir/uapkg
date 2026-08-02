import { describe, expect, it } from 'vitest';
import { UAPKG_BUILD_METADATA } from '../../src/build/BuildMetadata.js';
import {
  controlPlaneEndpointsForBuildMode,
  UAPKG_CONTROL_PLANE_ENDPOINTS,
} from '../../src/control-plane/ControlPlaneEndpoints.js';
import {
  registryAudience,
  UAPKG_AUTHORIZATION_ISSUER,
  UAPKG_CONTROL_PLANE_API,
} from '../../src/control-plane/ControlPlaneTypes.js';

describe('build-pinned control-plane endpoints', () => {
  it('maps development and production builds to isolated endpoint pairs', () => {
    expect(controlPlaneEndpointsForBuildMode('development')).toEqual({
      issuer: 'https://account-dev.uapkg.dev/oauth',
      apiBaseUrl: 'https://api-dev.uapkg.dev',
    });
    expect(controlPlaneEndpointsForBuildMode('production')).toEqual({
      issuer: 'https://account.uapkg.dev/oauth',
      apiBaseUrl: 'https://api.uapkg.dev',
    });
    expect(Object.isFrozen(controlPlaneEndpointsForBuildMode('development'))).toBe(true);
    expect(Object.isFrozen(controlPlaneEndpointsForBuildMode('production'))).toBe(true);
  });

  it('uses production endpoints for source execution and derives registry audiences from the selected API', () => {
    expect(UAPKG_BUILD_METADATA.mode).toBe('production');
    expect(UAPKG_CONTROL_PLANE_ENDPOINTS).toBe(controlPlaneEndpointsForBuildMode('production'));
    expect(UAPKG_AUTHORIZATION_ISSUER).toBe('https://account.uapkg.dev/oauth');
    expect(UAPKG_CONTROL_PLANE_API).toBe('https://api.uapkg.dev');
    expect(registryAudience('registry/id')).toBe('https://api.uapkg.dev/v1/registries/registry%2Fid');
  });
});
