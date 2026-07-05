export type BugCaptureErrorCode = 'github_api_error' | 'missing_scope';

export interface BugCaptureErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling plugins use. The scaffold's tool surface is read-only; write
 * tools arriving with the Layer 1 core (epic #28) extend the code union
 * as they add write guards. */
export class BugCaptureError extends Error {
  readonly code: BugCaptureErrorCode;
  readonly details: BugCaptureErrorDetails;

  constructor(code: BugCaptureErrorCode, message: string, details: BugCaptureErrorDetails = {}) {
    super(message);
    this.name = 'BugCaptureError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: BugCaptureErrorCode; message: string } & BugCaptureErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isBugCaptureError(err: unknown): err is BugCaptureError {
  return err instanceof BugCaptureError;
}
