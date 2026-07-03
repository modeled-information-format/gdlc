export type PlanningErrorCode =
  | 'limit_exceeded'
  | 'missing_scope'
  | 'resolve_issue_id'
  | 'resolve_project_id'
  | 'unknown_issue_type'
  | 'rate_limited'
  | 'github_api_error'
  | 'confirmation_required';

export interface PlanningErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error. Every failure mode named in the feature spec's
 * Edge Cases section gets one of these codes, never a raw GraphQL/REST error
 * surfaced verbatim to the caller. */
export class PlanningError extends Error {
  readonly code: PlanningErrorCode;
  readonly details: PlanningErrorDetails;

  constructor(code: PlanningErrorCode, message: string, details: PlanningErrorDetails = {}) {
    super(message);
    this.name = 'PlanningError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: PlanningErrorCode; message: string } & PlanningErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isPlanningError(err: unknown): err is PlanningError {
  return err instanceof PlanningError;
}
