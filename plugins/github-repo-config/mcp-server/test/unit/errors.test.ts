import { describe, it, expect } from 'vitest';
import { RepoConfigError, isRepoConfigError } from '../../src/errors.js';

describe('RepoConfigError', () => {
  it('serializes to JSON with the error code, message, and details spread in', () => {
    const err = new RepoConfigError('confirmation_mismatch', 'branch and confirmBranch must match', { branch: 'main', confirmBranch: 'dev' });
    expect(err.toJSON()).toEqual({ error: 'confirmation_mismatch', message: 'branch and confirmBranch must match', branch: 'main', confirmBranch: 'dev' });
  });

  it('defaults details to an empty object', () => {
    const err = new RepoConfigError('github_api_error', 'boom');
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom' });
  });
});

describe('isRepoConfigError', () => {
  it('returns true for a RepoConfigError instance', () => {
    expect(isRepoConfigError(new RepoConfigError('missing_scope', 'no token'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isRepoConfigError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isRepoConfigError('not an error')).toBe(false);
  });
});
