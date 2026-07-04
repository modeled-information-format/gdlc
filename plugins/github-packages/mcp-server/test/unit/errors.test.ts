import { describe, it, expect } from 'vitest';
import { PackagesError, isPackagesError } from '../../src/errors.js';

describe('PackagesError', () => {
  it('serializes to JSON with the error code, message, and details spread in', () => {
    const err = new PackagesError('confirmation_mismatch', 'packageName mismatch', { actual: 'left-pad', confirmed: 'is-odd' });
    expect(err.toJSON()).toEqual({ error: 'confirmation_mismatch', message: 'packageName mismatch', actual: 'left-pad', confirmed: 'is-odd' });
  });

  it('defaults details to an empty object', () => {
    const err = new PackagesError('github_api_error', 'boom');
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom' });
  });
});

describe('isPackagesError', () => {
  it('returns true for a PackagesError instance', () => {
    expect(isPackagesError(new PackagesError('missing_scope', 'no token'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isPackagesError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isPackagesError('not an error')).toBe(false);
  });
});
