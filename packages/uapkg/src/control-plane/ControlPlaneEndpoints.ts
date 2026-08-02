import type { UAPKGBuildMode } from '@uapkg/common';
import { UAPKG_BUILD_METADATA } from '../build/BuildMetadata.js';

export interface UAPKGControlPlaneEndpoints {
  readonly issuer: string;
  readonly apiBaseUrl: string;
}

const DEVELOPMENT_ENDPOINTS: UAPKGControlPlaneEndpoints = Object.freeze({
  issuer: 'https://account-dev.uapkg.dev/oauth',
  apiBaseUrl: 'https://api-dev.uapkg.dev',
});

const PRODUCTION_ENDPOINTS: UAPKGControlPlaneEndpoints = Object.freeze({
  issuer: 'https://account.uapkg.dev/oauth',
  apiBaseUrl: 'https://api.uapkg.dev',
});

/**
 * Only an explicitly stamped development build can select development trust
 * roots. Source execution and any unrecognized runtime value fail closed to
 * the production control plane.
 */
export function controlPlaneEndpointsForBuildMode(mode: UAPKGBuildMode): UAPKGControlPlaneEndpoints {
  return mode === 'development' ? DEVELOPMENT_ENDPOINTS : PRODUCTION_ENDPOINTS;
}

export const UAPKG_CONTROL_PLANE_ENDPOINTS = controlPlaneEndpointsForBuildMode(UAPKG_BUILD_METADATA.mode);
