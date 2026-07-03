import { describe, it, expect } from 'vitest';
import { PrError, isPrError } from '../../src/errors.js';

describe('PrError', () => {
  it('carries a structured code, message, and details', () => {
    const err = new PrError('stale_target', 'PR closed', { pullNumber: 5 });
    expect(err.code).toBe('stale_target');
    expect(err.details).toEqual({ pullNumber: 5 });
  });

  it('serializes to a flat JSON error object', () => {
    const err = new PrError('github_api_error', 'boom');
    expect(err.toJSON()).toEqual({ error: 'github_api_error', message: 'boom' });
  });

  it('is distinguishable from a plain Error', () => {
    expect(isPrError(new PrError('rate_limited', 'slow down'))).toBe(true);
    expect(isPrError(new Error('plain'))).toBe(false);
  });
});
