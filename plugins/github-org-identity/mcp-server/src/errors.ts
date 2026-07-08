export type OrgIdentityErrorCode = 'github_api_error' | 'missing_scope' | 'confirmation_mismatch' | 'feature_unavailable';

export interface OrgIdentityErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling github-sdlc-planning/github-pull-requests plugins use. */
export class OrgIdentityError extends Error {
  readonly code: OrgIdentityErrorCode;
  readonly details: OrgIdentityErrorDetails;

  constructor(code: OrgIdentityErrorCode, message: string, details: OrgIdentityErrorDetails = {}) {
    super(message);
    this.name = 'OrgIdentityError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: OrgIdentityErrorCode; message: string } & OrgIdentityErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isOrgIdentityError(err: unknown): err is OrgIdentityError {
  return err instanceof OrgIdentityError;
}
