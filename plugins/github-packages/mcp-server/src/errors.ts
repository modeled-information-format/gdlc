export type PackagesErrorCode = 'github_api_error' | 'missing_scope' | 'confirmation_mismatch';

export interface PackagesErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling plugins use. */
export class PackagesError extends Error {
  readonly code: PackagesErrorCode;
  readonly details: PackagesErrorDetails;

  constructor(code: PackagesErrorCode, message: string, details: PackagesErrorDetails = {}) {
    super(message);
    this.name = 'PackagesError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: PackagesErrorCode; message: string } & PackagesErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isPackagesError(err: unknown): err is PackagesError {
  return err instanceof PackagesError;
}
