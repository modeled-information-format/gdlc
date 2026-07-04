export type RepoConfigErrorCode = 'github_api_error' | 'missing_scope' | 'confirmation_mismatch';

export interface RepoConfigErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling plugins use. */
export class RepoConfigError extends Error {
  readonly code: RepoConfigErrorCode;
  readonly details: RepoConfigErrorDetails;

  constructor(code: RepoConfigErrorCode, message: string, details: RepoConfigErrorDetails = {}) {
    super(message);
    this.name = 'RepoConfigError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: RepoConfigErrorCode; message: string } & RepoConfigErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isRepoConfigError(err: unknown): err is RepoConfigError {
  return err instanceof RepoConfigError;
}
