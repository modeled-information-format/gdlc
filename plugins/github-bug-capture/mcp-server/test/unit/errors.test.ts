import { describe, it, expect } from 'vitest';
import { BugCaptureError, isBugCaptureError } from '../../src/errors.js';

describe('BugCaptureError', () => {
  it('serializes to JSON with the error code, message, and details spread in', () => {
    const err = new BugCaptureError('github_api_error', 'boom', { status: 500 });
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom', status: 500 });
  });

  it('defaults details to an empty object', () => {
    const err = new BugCaptureError('missing_scope', 'no token');
    expect(err.toJSON()).toEqual({ error: 'missing_scope', message: 'no token' });
  });
});

describe('isBugCaptureError', () => {
  it('returns true for a BugCaptureError instance', () => {
    expect(isBugCaptureError(new BugCaptureError('missing_scope', 'no token'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isBugCaptureError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isBugCaptureError('not an error')).toBe(false);
  });
});
