import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { createIssue, updateIssue } from '../../src/tools/issues.js';

describe('createIssue', () => {
  it('AC-1: creates via the GraphQL createIssue mutation with a MIF frontmatter block prepended', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedBody = '';
    mockGraphQL((body) => {
      if (body.query.includes('createIssue')) {
        capturedBody = body.variables.body as string;
        return { createIssue: { issue: { number: 42, id: 'I_42', url: 'https://github.com/acme/widgets/issues/42', body: capturedBody } } };
      }
      throw new Error(`unexpected query in test: ${body.query}`);
    });

    const result = await createIssue({
      owner: 'acme',
      repo: 'widgets',
      title: 'Ship the thing',
      body: '## Summary\nShip it.',
      mif: { id: 'ship-the-thing', type: 'Task', namespace: 'acme-widgets' },
    });

    expect(result.number).toBe(42);
    expect(capturedBody).toContain('<!-- mif-id: urn:mif:concept:acme-widgets:ship-the-thing -->');
    expect(capturedBody).toContain('<!-- mif-type: Task -->');
    expect(capturedBody).toContain('<!-- mif-ns: acme-widgets -->');
    expect(capturedBody).toContain('## Summary\nShip it.');
  });

  it('resolves label, assignee, milestone, and issue-type IDs before mutating', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    mockRest('get', '/repos/acme/widgets/labels/bug', { node_id: 'L_bug' });
    mockRest('get', '/users/octocat', { node_id: 'U_octocat' });
    mockRest('get', '/repos/acme/widgets/milestones/3', { node_id: 'M_3' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('issueTypes')) {
        return { organization: { issueTypes: { nodes: [{ id: 'IT_bug', name: 'Bug' }] } } };
      }
      capturedVars = body.variables;
      return { createIssue: { issue: { number: 1, id: 'I_1', url: 'https://x', body: '' } } };
    });

    await createIssue({
      owner: 'acme',
      repo: 'widgets',
      title: 'A bug',
      body: 'oops',
      labels: ['bug'],
      assignees: ['octocat'],
      milestoneNumber: 3,
      issueType: 'Bug',
      mif: { id: 'a-bug', type: 'Bug', namespace: 'acme-widgets' },
    });

    expect(capturedVars.labelIds).toEqual(['L_bug']);
    expect(capturedVars.assigneeIds).toEqual(['U_octocat']);
    expect(capturedVars.milestoneId).toBe('M_3');
    expect(capturedVars.issueTypeId).toBe('IT_bug');
  });
});

describe('updateIssue', () => {
  it('AC-7: rejects an issueType absent from organization.issueTypes before calling the update endpoint', async () => {
    mockGraphQL(() => ({ organization: { issueTypes: { nodes: [{ id: 'IT_bug', name: 'Bug' }] } } }));
    // No REST PATCH handler registered: the assertion below only holds if
    // updateIssue never reaches it (msw would error on an unhandled request).
    await expect(
      updateIssue({ owner: 'acme', repo: 'widgets', number: 5, issueType: 'NotARealType' }),
    ).rejects.toMatchObject({ code: 'unknown_issue_type' });
  });

  it('PATCHes title/body/state/type when the issueType is valid', async () => {
    mockGraphQL(() => ({ organization: { issueTypes: { nodes: [{ id: 'IT_bug', name: 'Bug' }] } } }));
    mockRest('patch', '/repos/acme/widgets/issues/5', { number: 5, html_url: 'https://github.com/acme/widgets/issues/5' });
    const result = await updateIssue({ owner: 'acme', repo: 'widgets', number: 5, title: 'New title', issueType: 'Bug' });
    expect(result).toEqual({ number: 5, url: 'https://github.com/acme/widgets/issues/5' });
  });

  it('PATCHes body and state without touching title or issueType', async () => {
    mockRest('patch', '/repos/acme/widgets/issues/5', { number: 5, html_url: 'https://github.com/acme/widgets/issues/5' });
    const result = await updateIssue({ owner: 'acme', repo: 'widgets', number: 5, body: 'Updated body', state: 'closed' });
    expect(result).toEqual({ number: 5, url: 'https://github.com/acme/widgets/issues/5' });
  });
});
