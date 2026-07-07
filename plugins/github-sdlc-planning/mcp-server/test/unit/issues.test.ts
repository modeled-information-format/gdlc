import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest, mockGraphQL } from '../helpers.js';
import { createIssue, updateIssue } from '../../src/tools/issues.js';

describe('createIssue', () => {
  it('AC-1: creates via the GraphQL createIssue mutation with a MIF frontmatter block prepended', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedBody = '';
    mockGraphQL((body) => {
      if (body.query.includes('issueTypes')) {
        // Org has no matching native issue type defined for the derived
        // default ("Task", from mif.type: Task) -- createIssue must still
        // succeed, degrading to no issueType (see the "degrades" test below).
        return { organization: { issueTypes: { nodes: [] } } };
      }
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

  it('issue #108 Bug 2: auto-derives a native issueType from mif.type when issueType is omitted', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('issueTypes')) {
        return { organization: { issueTypes: { nodes: [{ id: 'IT_bug', name: 'Bug' }, { id: 'IT_feature', name: 'Feature' }] } } };
      }
      capturedVars = body.variables;
      return { createIssue: { issue: { number: 1, id: 'I_1', url: 'https://x', body: '' } } };
    });

    await createIssue({
      owner: 'acme',
      repo: 'widgets',
      title: 'A bug',
      body: 'oops',
      mif: { id: 'a-bug', type: 'Bug', namespace: 'acme-widgets' },
    });
    expect(capturedVars.issueTypeId).toBe('IT_bug');

    await createIssue({
      owner: 'acme',
      repo: 'widgets',
      title: 'An epic',
      body: 'big goal',
      mif: { id: 'an-epic', type: 'Epic', namespace: 'acme-widgets' },
    });
    expect(capturedVars.issueTypeId).toBe('IT_feature');
  });

  it('issue #108 Bug 2: degrades to no issueType when the org has not defined the derived native type', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('issueTypes')) {
        return { organization: { issueTypes: { nodes: [] } } };
      }
      capturedVars = body.variables;
      return { createIssue: { issue: { number: 1, id: 'I_1', url: 'https://x', body: '' } } };
    });

    const result = await createIssue({
      owner: 'acme',
      repo: 'widgets',
      title: 'A task',
      body: 'todo',
      mif: { id: 'a-task', type: 'Task', namespace: 'acme-widgets' },
    });

    expect(result.number).toBe(1);
    expect(capturedVars.issueTypeId).toBeUndefined();
  });

  it('an explicit issueType still fails closed when unknown, even though a derived default would degrade gracefully', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    mockGraphQL((body) => {
      if (body.query.includes('issueTypes')) {
        return { organization: { issueTypes: { nodes: [] } } };
      }
      throw new Error(`unexpected query in test: ${body.query}`);
    });

    await expect(
      createIssue({
        owner: 'acme',
        repo: 'widgets',
        title: 'A bug',
        body: 'oops',
        issueType: 'NotARealType',
        mif: { id: 'a-bug', type: 'Bug', namespace: 'acme-widgets' },
      }),
    ).rejects.toMatchObject({ code: 'unknown_issue_type' });
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

  it('issue #108 Bug 1: sends `type` as the bare type-name string, not { name }, so GitHub actually applies it', async () => {
    mockGraphQL(() => ({ organization: { issueTypes: { nodes: [{ id: 'IT_feature', name: 'Feature' }] } } }));
    let capturedBody: Record<string, unknown> = {};
    server.use(
      http.patch('https://api.github.com/repos/acme/widgets/issues/5', async ({ request }) => {
        capturedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ number: 5, html_url: 'https://github.com/acme/widgets/issues/5' });
      }),
    );

    await updateIssue({ owner: 'acme', repo: 'widgets', number: 5, issueType: 'Feature' });

    // The REST "Update an issue" endpoint's `type` field is documented as a
    // bare string (the type name) or null -- an object like { name: 'Feature' }
    // doesn't match that shape and GitHub silently ignores it (200 OK, no
    // error, issueType stays null). This is the exact silent no-op from #108.
    expect(capturedBody.type).toBe('Feature');
  });
});
