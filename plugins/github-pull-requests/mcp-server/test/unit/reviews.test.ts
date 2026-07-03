import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { requestReview, listReviewRequests, removeReviewRequest } from '../../src/tools/reviews.js';

describe('requestReview', () => {
  it('AC-1: requests reviewers via POST .../requested_reviewers', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/10', { state: 'open', merged: false });
    mockRest('post', '/repos/acme/widgets/pulls/10/requested_reviewers', {
      users: [{ login: 'octocat' }],
      teams: [{ slug: 'reviewers' }],
    });
    const result = await requestReview({ owner: 'acme', repo: 'widgets', pullNumber: 10, reviewers: ['octocat'], teamReviewers: ['reviewers'] });
    expect(result).toEqual({ users: ['octocat'], teams: ['reviewers'] });
  });

  it('Edge Case: reports stale_target when the PR closed before the request landed', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/11', { state: 'closed', merged: false });
    await expect(
      requestReview({ owner: 'acme', repo: 'widgets', pullNumber: 11, reviewers: ['octocat'] }),
    ).rejects.toMatchObject({ code: 'stale_target', details: { state: 'closed', merged: false } });
  });

  it('Edge Case: reports stale_target as merged when the PR was merged, not just closed', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/13', { state: 'closed', merged: true });
    await expect(
      requestReview({ owner: 'acme', repo: 'widgets', pullNumber: 13, reviewers: ['octocat'] }),
    ).rejects.toMatchObject({ code: 'stale_target', message: expect.stringContaining('merged, not open') });
  });

  it('defaults reviewers/teamReviewers to empty arrays when omitted', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/14', { state: 'open', merged: false });
    mockRest('post', '/repos/acme/widgets/pulls/14/requested_reviewers', { users: [], teams: [] });
    const result = await requestReview({ owner: 'acme', repo: 'widgets', pullNumber: 14 });
    expect(result).toEqual({ users: [], teams: [] });
  });

  it('Edge Case: surfaces a team-without-access rejection verbatim, no retry', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/12', { state: 'open', merged: false });
    mockRest('post', '/repos/acme/widgets/pulls/12/requested_reviewers', { message: 'Team does not have access to this repository' }, 422);
    await expect(
      requestReview({ owner: 'acme', repo: 'widgets', pullNumber: 12, teamReviewers: ['no-access-team'] }),
    ).rejects.toMatchObject({ code: 'github_api_error', message: expect.stringContaining('Team does not have access') });
  });
});

describe('listReviewRequests', () => {
  it('AC-2: returns current requested reviewers without a separate Timeline call', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/10/requested_reviewers', {
      users: [{ login: 'octocat' }],
      teams: [{ slug: 'reviewers' }],
    });
    const result = await listReviewRequests({ owner: 'acme', repo: 'widgets', pullNumber: 10 });
    expect(result).toEqual({ users: ['octocat'], teams: ['reviewers'] });
  });
});

describe('removeReviewRequest', () => {
  it('removes reviewers via DELETE .../requested_reviewers', async () => {
    mockRest('delete', '/repos/acme/widgets/pulls/10/requested_reviewers', {
      users: [{ login: 'octocat' }],
      teams: [{ slug: 'reviewers' }],
    });
    const result = await removeReviewRequest({ owner: 'acme', repo: 'widgets', pullNumber: 10, reviewers: ['octocat'] });
    expect(result).toEqual({ users: ['octocat'], teams: ['reviewers'] });
  });

  it('defaults reviewers/teamReviewers to empty arrays when omitted', async () => {
    mockRest('delete', '/repos/acme/widgets/pulls/15/requested_reviewers', { users: [], teams: [] });
    const result = await removeReviewRequest({ owner: 'acme', repo: 'widgets', pullNumber: 15 });
    expect(result).toEqual({ users: [], teams: [] });
  });
});
