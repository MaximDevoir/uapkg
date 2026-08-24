import type { DiagnosticBase } from '../base/Diagnostic.ts';

/**
 * Safe, user-facing context for a failed publish request. The fixed set of
 * kinds prevents arbitrary control-plane details from leaking into output.
 */
export type PublishDiagnosticFact =
  | { readonly kind: 'package'; readonly value: string }
  | { readonly kind: 'version'; readonly value: string }
  | { readonly kind: 'registry'; readonly value: string }
  | { readonly kind: 'credential-kind'; readonly value: string }
  | { readonly kind: 'requested-owner'; readonly value: string }
  | { readonly kind: 'token-owner'; readonly value: string }
  | { readonly kind: 'allowed-owner'; readonly value: string }
  | { readonly kind: 'actual-access-mode'; readonly value: string }
  | { readonly kind: 'required-access-mode'; readonly value: string }
  | { readonly kind: 'repository'; readonly value: string }
  | { readonly kind: 'requested-repository'; readonly value: string }
  | { readonly kind: 'trusted-repository'; readonly value: string }
  | { readonly kind: 'request-id'; readonly value: string }
  | { readonly kind: 'retry-after'; readonly value: string }
  | { readonly kind: 'missing-capability'; readonly value: string };

/** A CLI command or account page that can help resolve a publish failure. */
export type PublishDiagnosticResource =
  | {
      readonly kind: 'command';
      readonly command: string;
      readonly label?: string;
    }
  | {
      readonly kind: 'url';
      readonly url: string;
      readonly label?: string;
    };

export interface PublishRequestFailedDiagnosticData {
  /** Stable control-plane error code, when a response was received. */
  readonly serverCode?: string;
  /** HTTP response status, when a response was received. */
  readonly status?: number;
  /** Validated facts that are safe to show to the user. */
  readonly facts: readonly PublishDiagnosticFact[];
  /** Commands and account pages that can help the user recover. */
  readonly resources: readonly PublishDiagnosticResource[];
}

export type PublishRequestFailedDiagnostic = DiagnosticBase<
  'PUBLISH_REQUEST_FAILED',
  PublishRequestFailedDiagnosticData
>;

export type PublishingDiagnostic = PublishRequestFailedDiagnostic;

export function createPublishRequestFailedDiagnostic(
  message: string,
  data: PublishRequestFailedDiagnosticData,
  hint?: string,
): PublishRequestFailedDiagnostic {
  return {
    level: 'error',
    code: 'PUBLISH_REQUEST_FAILED',
    message,
    hint,
    data,
  };
}
