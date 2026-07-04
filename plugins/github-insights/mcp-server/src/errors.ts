export type InsightsErrorCode = 'github_api_error' | 'missing_scope';

export interface InsightsErrorDetails {
  [key: string]: unknown;
}

/** Structured tool-call error, matching the error-shape convention the
 * sibling plugins use. No confirmation_mismatch code here -- every tool
 * in this plugin is read-only (the underlying GitHub REST endpoints have
 * no write counterpart at all), so there's no write-guard to model. */
export class InsightsError extends Error {
  readonly code: InsightsErrorCode;
  readonly details: InsightsErrorDetails;

  constructor(code: InsightsErrorCode, message: string, details: InsightsErrorDetails = {}) {
    super(message);
    this.name = 'InsightsError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { error: InsightsErrorCode; message: string } & InsightsErrorDetails {
    return { error: this.code, message: this.message, ...this.details };
  }
}

export function isInsightsError(err: unknown): err is InsightsError {
  return err instanceof InsightsError;
}
