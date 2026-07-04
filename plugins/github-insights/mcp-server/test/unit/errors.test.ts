import { describe, it, expect } from 'vitest';
import { InsightsError, isInsightsError } from '../../src/errors.js';

describe('InsightsError', () => {
  it('serializes to JSON with the error code, message, and details spread in', () => {
    const err = new InsightsError('github_api_error', 'boom', { status: 500 });
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom', status: 500 });
  });

  it('defaults details to an empty object', () => {
    const err = new InsightsError('missing_scope', 'no token');
    expect(err.toJSON()).toEqual({ error: 'missing_scope', message: 'no token' });
  });
});

describe('isInsightsError', () => {
  it('returns true for an InsightsError instance', () => {
    expect(isInsightsError(new InsightsError('missing_scope', 'no token'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isInsightsError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isInsightsError('not an error')).toBe(false);
  });
});
