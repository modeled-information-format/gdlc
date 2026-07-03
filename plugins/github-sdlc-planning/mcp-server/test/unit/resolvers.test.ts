import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { resolveRepositoryId, resolveIssueNodeId, resolveProjectNodeId, resolveIssueTypeId } from '../../src/resolvers.js';

describe('resolveRepositoryId', () => {
  it('resolves a repository node ID', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_repo123' });
    await expect(resolveRepositoryId('acme', 'widgets')).resolves.toBe('R_repo123');
  });

  it('names the failed lookup step, not a raw error', async () => {
    mockRest('get', '/repos/acme/ghost', { message: 'Not Found' }, 404);
    await expect(resolveRepositoryId('acme', 'ghost')).rejects.toMatchObject({
      code: 'resolve_issue_id',
      details: { lookupStep: 'resolve_repository_id' },
    });
  });

  it('fails the same way when the response is 2xx but missing node_id', async () => {
    mockRest('get', '/repos/acme/weird', {});
    await expect(resolveRepositoryId('acme', 'weird')).rejects.toMatchObject({
      code: 'resolve_issue_id',
      details: { lookupStep: 'resolve_repository_id' },
    });
  });
});

describe('resolveIssueNodeId', () => {
  it('resolves an issue node ID', async () => {
    mockRest('get', '/repos/acme/widgets/issues/7', { node_id: 'I_issue7' });
    await expect(resolveIssueNodeId('acme', 'widgets', 7)).resolves.toBe('I_issue7');
  });

  it('names resolve_issue_id as the failed lookup step', async () => {
    mockRest('get', '/repos/acme/widgets/issues/999', { message: 'Not Found' }, 404);
    await expect(resolveIssueNodeId('acme', 'widgets', 999)).rejects.toMatchObject({
      code: 'resolve_issue_id',
      details: { lookupStep: 'resolve_issue_id' },
    });
  });

  it('fails the same way when the response is 2xx but missing node_id', async () => {
    mockRest('get', '/repos/acme/widgets/issues/998', {});
    await expect(resolveIssueNodeId('acme', 'widgets', 998)).rejects.toMatchObject({
      code: 'resolve_issue_id',
      details: { lookupStep: 'resolve_issue_id' },
    });
  });
});

describe('resolveProjectNodeId', () => {
  it('resolves an organization project node ID', async () => {
    mockGraphQL(() => ({ organization: { projectV2: { id: 'PVT_org1' } } }));
    await expect(resolveProjectNodeId('acme', 3, 'organization')).resolves.toBe('PVT_org1');
  });

  it('resolves a user project node ID', async () => {
    mockGraphQL(() => ({ user: { projectV2: { id: 'PVT_user1' } } }));
    await expect(resolveProjectNodeId('octocat', 3, 'user')).resolves.toBe('PVT_user1');
  });

  it('names resolve_project_id as the failed lookup step when the project is absent', async () => {
    mockGraphQL(() => ({ organization: { projectV2: null } }));
    await expect(resolveProjectNodeId('acme', 999)).rejects.toMatchObject({
      code: 'resolve_project_id',
      details: { lookupStep: 'resolve_project_id' },
    });
  });

  it('names resolve_project_id as the failed lookup step for an absent user project too', async () => {
    mockGraphQL(() => ({ user: { projectV2: null } }));
    await expect(resolveProjectNodeId('octocat', 999, 'user')).rejects.toMatchObject({
      code: 'resolve_project_id',
      details: { lookupStep: 'resolve_project_id' },
    });
  });
});

describe('resolveIssueTypeId', () => {
  it('resolves a defined issue type', async () => {
    mockGraphQL(() => ({
      organization: { issueTypes: { nodes: [{ id: 'IT_1', name: 'Bug' }, { id: 'IT_2', name: 'Epic' }] } },
    }));
    await expect(resolveIssueTypeId('acme', 'Epic')).resolves.toBe('IT_2');
  });

  it('rejects an issueTypeId absent from organization.issueTypes before any write (AC-7)', async () => {
    mockGraphQL(() => ({ organization: { issueTypes: { nodes: [{ id: 'IT_1', name: 'Bug' }] } } }));
    await expect(resolveIssueTypeId('acme', 'NotARealType')).rejects.toMatchObject({
      code: 'unknown_issue_type',
    });
  });
});
