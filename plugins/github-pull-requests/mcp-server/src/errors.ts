export type PrErrorCode = 'github_api_error' | 'rate_limited' | 'stale_target';

export interface PrErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling github-sdlc-planning plugin uses. */
export class PrError extends Error {
  readonly code: PrErrorCode;
  readonly details: PrErrorDetails;

  constructor(code: PrErrorCode, message: string, details: PrErrorDetails = {}) {
    super(message);
    this.name = 'PrError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: PrErrorCode; message: string } & PrErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isPrError(err: unknown): err is PrError {
  return err instanceof PrError;
}
