import { describe, it, expect } from 'vitest';
import { mockGraphQL, mockRest } from '../helpers.js';
import { createPullRequest } from '../../src/tools/create-pull-request.js';

describe('createPullRequest', () => {
  it('resolves the repository node ID and opens the PR via createPullRequest', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      capturedVars = body.variables;
      return { createPullRequest: { pullRequest: { number: 12, url: 'https://github.com/acme/widgets/pull/12', id: 'PR_12' } } };
    });

    const result = await createPullRequest({
      owner: 'acme',
      repo: 'widgets',
      title: 'Add feature',
      body: 'Fixes #7',
      baseRefName: 'main',
      headRefName: 'feature-branch',
    });

    expect(capturedVars).toMatchObject({
      repositoryId: 'R_1',
      baseRefName: 'main',
      headRefName: 'feature-branch',
      title: 'Add feature',
      body: 'Fixes #7',
    });
    expect(result).toEqual({ number: 12, url: 'https://github.com/acme/widgets/pull/12', nodeId: 'PR_12' });
  });

  it('passes draft through to the mutation', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      capturedVars = body.variables;
      return { createPullRequest: { pullRequest: { number: 13, url: 'https://github.com/acme/widgets/pull/13', id: 'PR_13' } } };
    });

    await createPullRequest({
      owner: 'acme',
      repo: 'widgets',
      title: 'WIP',
      baseRefName: 'main',
      headRefName: 'wip-branch',
      draft: true,
    });

    expect(capturedVars.draft).toBe(true);
  });

  it('Edge Case: a GraphQL rejection (e.g. an existing open PR for this head) surfaces as github_api_error verbatim', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    mockGraphQL(() => ({
      __errors: [{ message: 'A pull request already exists for acme:feature-branch.' }],
    }));

    await expect(
      createPullRequest({ owner: 'acme', repo: 'widgets', title: 'Add feature', baseRefName: 'main', headRefName: 'feature-branch' }),
    ).rejects.toMatchObject({ code: 'github_api_error', message: expect.stringContaining('already exists') });
  });
});
