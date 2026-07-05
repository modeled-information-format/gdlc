export type BugCaptureErrorCode =
  | 'github_api_error'
  | 'missing_scope'
  | 'resolve_project_id'
  | 'resolve_issue_id'
  | 'issue_not_on_board'
  | 'field_type_conflict'
  | 'missing_field'
  | 'missing_option';

export interface BugCaptureErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling plugins use. Resolution failures (`resolve_*`) and the triage-board
 * preconditions (`issue_not_on_board`, `field_type_conflict`,
 * `missing_field`, `missing_option`) are named so a caller can branch on the
 * code instead of parsing GitHub's raw error text. */
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
