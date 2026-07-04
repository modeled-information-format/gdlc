import { describe, it, expect } from 'vitest';
import { OrgIdentityError, isOrgIdentityError } from '../../src/errors.js';

describe('OrgIdentityError', () => {
  it('serializes to JSON with the error code, message, and details spread in', () => {
    const err = new OrgIdentityError('confirmation_mismatch', 'roleId and confirmRoleId must match', { roleId: 1, confirmRoleId: 2 });
    expect(err.toJSON()).toEqual({
      error: 'confirmation_mismatch',
      message: 'roleId and confirmRoleId must match',
      roleId: 1,
      confirmRoleId: 2,
    });
  });

  it('defaults details to an empty object', () => {
    const err = new OrgIdentityError('github_api_error', 'boom');
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom' });
  });
});

describe('isOrgIdentityError', () => {
  it('returns true for an OrgIdentityError instance', () => {
    expect(isOrgIdentityError(new OrgIdentityError('missing_scope', 'no token'))).toBe(true);
  });

  it('returns false for a plain Error', () => {
    expect(isOrgIdentityError(new Error('plain'))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isOrgIdentityError('not an error')).toBe(false);
  });
});
