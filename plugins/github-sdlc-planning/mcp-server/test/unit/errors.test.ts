import { describe, it, expect } from 'vitest';
import { PlanningError, isPlanningError } from '../../src/errors.js';

describe('PlanningError', () => {
  it('carries a structured code, message, and details', () => {
    const err = new PlanningError('limit_exceeded', 'too many sub-issues', { max: 100, current: 100 });
    expect(err.code).toBe('limit_exceeded');
    expect(err.message).toBe('too many sub-issues');
    expect(err.details).toEqual({ max: 100, current: 100 });
    expect(err.name).toBe('PlanningError');
  });

  it('serializes to a flat JSON error object', () => {
    const err = new PlanningError('missing_scope', 'no project scope', { missingScope: 'project' });
    expect(err.toJSON()).toEqual({ error: 'missing_scope', message: 'no project scope', missingScope: 'project' });
  });

  it('is distinguishable from a plain Error via isPlanningError', () => {
    expect(isPlanningError(new PlanningError('rate_limited', 'slow down'))).toBe(true);
    expect(isPlanningError(new Error('plain'))).toBe(false);
    expect(isPlanningError('not an error')).toBe(false);
  });
});
