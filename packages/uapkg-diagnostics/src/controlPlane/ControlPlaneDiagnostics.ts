import type { DiagnosticBase } from '../base/Diagnostic.js';

export type LoginDiagnosticCode =
  | 'LOGIN_ACCESS_DENIED'
  | 'LOGIN_AUTHORIZATION_TIMEOUT'
  | 'LOGIN_AUTHORIZATION_RESPONSE_INVALID'
  | 'LOGIN_OAUTH_ERROR'
  | 'LOGIN_FAILED';

export interface LoginDiagnosticData {
  readonly oauthError?: string;
}

export type LoginAccessDeniedDiagnostic = DiagnosticBase<'LOGIN_ACCESS_DENIED', LoginDiagnosticData>;
export type LoginAuthorizationTimeoutDiagnostic = DiagnosticBase<'LOGIN_AUTHORIZATION_TIMEOUT', LoginDiagnosticData>;
export type LoginAuthorizationResponseInvalidDiagnostic = DiagnosticBase<
  'LOGIN_AUTHORIZATION_RESPONSE_INVALID',
  LoginDiagnosticData
>;
export type LoginOAuthErrorDiagnostic = DiagnosticBase<'LOGIN_OAUTH_ERROR', LoginDiagnosticData>;
export type LoginFailedDiagnostic = DiagnosticBase<'LOGIN_FAILED', LoginDiagnosticData>;

export type ControlPlaneDiagnostic =
  | LoginAccessDeniedDiagnostic
  | LoginAuthorizationTimeoutDiagnostic
  | LoginAuthorizationResponseInvalidDiagnostic
  | LoginOAuthErrorDiagnostic
  | LoginFailedDiagnostic;

export type LoginDiagnosticByCode<C extends LoginDiagnosticCode> = Extract<ControlPlaneDiagnostic, { code: C }>;
