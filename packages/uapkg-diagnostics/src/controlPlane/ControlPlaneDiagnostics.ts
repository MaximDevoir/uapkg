import type { DiagnosticBase } from '../base/Diagnostic.ts';

export type LoginDiagnosticCode =
  | 'LOGIN_ACCESS_DENIED'
  | 'LOGIN_AUTHORIZATION_TIMEOUT'
  | 'LOGIN_AUTHORIZATION_RESPONSE_INVALID'
  | 'LOGIN_REAUTHORIZATION_CONFLICT'
  | 'LOGIN_OAUTH_ERROR'
  | 'LOGIN_FAILED';

export interface LoginDiagnosticData {
  readonly oauthError?: string;
}

export interface ControlPlaneCommandFailedDiagnosticData {
  readonly operation: string;
  readonly serverCode?: string;
  readonly status?: number;
}

export type LoginAccessDeniedDiagnostic = DiagnosticBase<'LOGIN_ACCESS_DENIED', LoginDiagnosticData>;
export type LoginAuthorizationTimeoutDiagnostic = DiagnosticBase<'LOGIN_AUTHORIZATION_TIMEOUT', LoginDiagnosticData>;
export type LoginAuthorizationResponseInvalidDiagnostic = DiagnosticBase<
  'LOGIN_AUTHORIZATION_RESPONSE_INVALID',
  LoginDiagnosticData
>;
export type LoginReauthorizationConflictDiagnostic = DiagnosticBase<
  'LOGIN_REAUTHORIZATION_CONFLICT',
  LoginDiagnosticData
>;
export type LoginOAuthErrorDiagnostic = DiagnosticBase<'LOGIN_OAUTH_ERROR', LoginDiagnosticData>;
export type LoginFailedDiagnostic = DiagnosticBase<'LOGIN_FAILED', LoginDiagnosticData>;
export type ControlPlaneCommandFailedDiagnostic = DiagnosticBase<
  'CONTROL_PLANE_COMMAND_FAILED',
  ControlPlaneCommandFailedDiagnosticData
>;

export type ControlPlaneDiagnostic =
  | LoginAccessDeniedDiagnostic
  | LoginAuthorizationTimeoutDiagnostic
  | LoginAuthorizationResponseInvalidDiagnostic
  | LoginReauthorizationConflictDiagnostic
  | LoginOAuthErrorDiagnostic
  | LoginFailedDiagnostic
  | ControlPlaneCommandFailedDiagnostic;

export type LoginDiagnosticByCode<C extends LoginDiagnosticCode> = Extract<ControlPlaneDiagnostic, { code: C }>;

export function createControlPlaneCommandFailedDiagnostic(
  message: string,
  data: ControlPlaneCommandFailedDiagnosticData,
): ControlPlaneCommandFailedDiagnostic {
  return {
    level: 'error',
    code: 'CONTROL_PLANE_COMMAND_FAILED',
    message,
    data,
  };
}
