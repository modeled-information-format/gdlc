import { describe, it, expect } from 'vitest';
import { mockGraphQL, mockRest, mockUserScopes } from '../helpers.js';
import { addPullRequestToProject } from '../../src/tools/pr-projects.js';

describe('addPullRequestToProject', () => {
  it('resolves the PR and project node IDs before mutating, never a numeric ID', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/pulls/10', { node_id: 'PR_10' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      capturedVars = body.variables;
      return { addProjectV2ItemById: { item: { id: 'PVTI_9' } } };
    });

    const result = await addPullRequestToProject({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 10,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });

    expect(capturedVars.contentId).toBe('PR_10');
    expect(capturedVars.projectId).toBe('PVT_1');
    expect(result.itemId).toBe('PVTI_9');
  });

  it('Edge Case: fails with a named missing_scope error, not the raw GraphQL permission error', async () => {
    mockUserScopes(['repo']);
    await expect(
      addPullRequestToProject({ owner: 'acme', repo: 'widgets', pullNumber: 10, projectOwnerLogin: 'acme', projectNumber: 4 }),
    ).rejects.toMatchObject({ code: 'missing_scope' });
  });

  it('Edge Case: wraps a resolveProjectNodeId failure as resolve_id_failed, not a bare PlanningError', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/pulls/10', { node_id: 'PR_10' });
    mockGraphQL(() => ({ organization: { projectV2: null } }));

    await expect(
      addPullRequestToProject({ owner: 'acme', repo: 'widgets', pullNumber: 10, projectOwnerLogin: 'acme', projectNumber: 4 }),
    ).rejects.toMatchObject({ code: 'resolve_id_failed', details: { lookupStep: 'resolve_project_id' } });
  });

  it('supports a user-owned project via projectOwnerType', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/pulls/11', { node_id: 'PR_11' });
    let sawUserQuery = false;
    mockGraphQL((body) => {
      if (body.query.includes('user(login')) {
        sawUserQuery = true;
        return { user: { projectV2: { id: 'PVT_2' } } };
      }
      return { addProjectV2ItemById: { item: { id: 'PVTI_11' } } };
    });

    await addPullRequestToProject({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 11,
      projectOwnerLogin: 'octocat',
      projectNumber: 1,
      projectOwnerType: 'user',
    });
    expect(sawUserQuery).toBe(true);
  });
});
