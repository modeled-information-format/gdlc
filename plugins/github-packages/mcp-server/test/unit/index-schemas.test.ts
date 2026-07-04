import { describe, it, expect } from 'vitest';
import { listOrgPackagesInputSchema } from '../../src/index.js';

describe('listOrgPackagesInputSchema', () => {
  it('rejects a call with no packageType -- the real endpoint 422s without one', () => {
    const result = listOrgPackagesInputSchema.safeParse({ org: 'acme' });
    expect(result.success).toBe(false);
  });

  it('accepts a call with a known packageType', () => {
    const result = listOrgPackagesInputSchema.safeParse({ org: 'acme', packageType: 'npm' });
    expect(result.success).toBe(true);
  });
});
