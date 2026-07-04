import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { getBranchProtection, updateBranchProtection, deleteBranchProtection } from '../../src/tools/branch-protection.js';

describe('getBranchProtection', () => {
  it('maps the protection config, defaulting a missing review requirement to null', () => {
    mockRest('get', '/repos/acme/widgets/branches/main/protection', {
      required_status_checks: { strict: true, contexts: ['ci'] },
      enforce_admins: { enabled: true },
      required_pull_request_reviews: null,
    });
    return getBranchProtection({ owner: 'acme', repo: 'widgets', branch: 'main' }).then((result) => {
      expect(result).toEqual({ requiredStatusChecks: { strict: true, contexts: ['ci'] }, enforceAdmins: true, requiredApprovingReviewCount: null });
    });
  });
});

describe('updateBranchProtection', () => {
  it('sends the full desired state including restrictions: null', async () => {
    mockRest('put', '/repos/acme/widgets/branches/main/protection', {
      required_status_checks: { strict: true, contexts: ['ci'] },
      enforce_admins: { enabled: false },
      required_pull_request_reviews: { required_approving_review_count: 2 },
    });
    const result = await updateBranchProtection({
      owner: 'acme',
      repo: 'widgets',
      branch: 'main',
      requiredStatusChecks: { strict: true, contexts: ['ci'] },
      enforceAdmins: false,
      requiredApprovingReviewCount: 2,
    });
    expect(result).toEqual({ requiredStatusChecks: { strict: true, contexts: ['ci'] }, enforceAdmins: false, requiredApprovingReviewCount: 2 });
  });

  it('requires the caller to state requiredApprovingReviewCount explicitly as null, not omit it -- an earlier version silently defaulted an omitted field to null/disabled, reintroducing the exact partial-patch risk this tool exists to avoid (caught in review)', async () => {
    mockRest('put', '/repos/acme/widgets/branches/main/protection', {
      required_status_checks: null,
      enforce_admins: { enabled: true },
      required_pull_request_reviews: null,
    });
    const result = await updateBranchProtection({
      owner: 'acme',
      repo: 'widgets',
      branch: 'main',
      requiredStatusChecks: null,
      enforceAdmins: true,
      requiredApprovingReviewCount: null,
    });
    expect(result).toEqual({ requiredStatusChecks: null, enforceAdmins: true, requiredApprovingReviewCount: null });
  });
});

describe('deleteBranchProtection', () => {
  it('deletes protection when branch and confirmBranch match', async () => {
    mockRest('delete', '/repos/acme/widgets/branches/main/protection', {}, 204);
    const result = await deleteBranchProtection({ owner: 'acme', repo: 'widgets', branch: 'main', confirmBranch: 'main' });
    expect(result).toEqual({ owner: 'acme', repo: 'widgets', branch: 'main' });
  });

  it('throws confirmation_mismatch before calling the API when branch and confirmBranch differ', async () => {
    await expect(deleteBranchProtection({ owner: 'acme', repo: 'widgets', branch: 'main', confirmBranch: 'dev' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
      details: { branch: 'main', confirmBranch: 'dev' },
    });
  });
});
