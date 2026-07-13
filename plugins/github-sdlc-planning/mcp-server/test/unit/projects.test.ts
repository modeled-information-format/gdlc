import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL, mockUserScopes } from '../helpers.js';
import { addItemToProject, setFieldValue, getProjectItems, getProjectStatusProfile } from '../../src/tools/projects.js';
import { readProjectProfile } from '../../src/project-profile.js';

describe('addItemToProject', () => {
  it('AC-3: resolves the issue and project node IDs before mutating, never a numeric ID', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('items(first: 100, after')) {
        return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
      }
      capturedVars = body.variables;
      return { addProjectV2ItemById: { item: { id: 'PVTI_1' } } };
    });

    const result = await addItemToProject({
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });

    expect(capturedVars.contentId).toBe('I_9');
    expect(capturedVars.projectId).toBe('PVT_1');
    expect(result.itemId).toBe('PVTI_1');
    expect(result.existed).toBe(false);
  });

  it('AC-4: fails with a named missing_scope error, not the raw GraphQL permission error', async () => {
    mockUserScopes(['repo']);
    await expect(
      addItemToProject({ owner: 'acme', repo: 'widgets', issueNumber: 9, projectOwnerLogin: 'acme', projectNumber: 4 }),
    ).rejects.toMatchObject({ code: 'missing_scope' });
  });

  it('ADR-0003: returns the existing item without mutating when the issue is already on the target project', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    let mutationCalls = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('items(first: 100, after')) {
        return {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                { id: 'PVTI_other', content: { number: 99, repository: { nameWithOwner: 'acme/widgets' } }, fieldValues: { nodes: [] } },
                { id: 'PVTI_existing', content: { number: 9, repository: { nameWithOwner: 'acme/widgets' } }, fieldValues: { nodes: [] } },
              ],
            },
          },
        };
      }
      mutationCalls += 1;
      return { addProjectV2ItemById: { item: { id: 'PVTI_should_not_happen' } } };
    });

    const result = await addItemToProject({
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });

    expect(result).toEqual({ itemId: 'PVTI_existing', existed: true });
    expect(mutationCalls).toBe(0);
  });

  // Issue #282: the existing-item check used to query the issue's own
  // projectItems connection, confirmed unreliable for a project owned by a
  // different entity than the issue's repo (same root cause as #273/#283).
  // Regression guard for the fix (project-side item scan instead).
  it('issue #282: finds the existing item even when it lives on a user-owned project', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    let mutationCalls = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { user: { projectV2: { id: 'PVT_u' } } };
      if (body.query.includes('items(first: 100, after')) {
        return {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ id: 'PVTI_existing', content: { number: 9, repository: { nameWithOwner: 'acme/widgets' } }, fieldValues: { nodes: [] } }],
            },
          },
        };
      }
      mutationCalls += 1;
      return { addProjectV2ItemById: { item: { id: 'PVTI_should_not_happen' } } };
    });

    const result = await addItemToProject({
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      projectOwnerType: 'user',
    });

    expect(result).toEqual({ itemId: 'PVTI_existing', existed: true });
    expect(mutationCalls).toBe(0);
  });

  // Case-insensitivity regression, mirroring gdlc#283's Copilot finding.
  it('issue #282: matches the existing item case-insensitively against owner/repo', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('items(first: 100, after')) {
        return {
          node: {
            items: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ id: 'PVTI_existing', content: { number: 9, repository: { nameWithOwner: 'Acme/Widgets' } }, fieldValues: { nodes: [] } }],
            },
          },
        };
      }
      return { addProjectV2ItemById: { item: { id: 'PVTI_should_not_happen' } } };
    });

    const result = await addItemToProject({
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });

    expect(result).toEqual({ itemId: 'PVTI_existing', existed: true });
  });

  it('ADR-0003: an issue not yet on the board still creates a new item (existed: false)', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('projectItems')) {
        return { repository: { issue: { projectItems: { nodes: [] } } } };
      }
      return { addProjectV2ItemById: { item: { id: 'PVTI_new' } } };
    });

    const result = await addItemToProject({
      owner: 'acme',
      repo: 'widgets',
      issueNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });

    expect(result).toEqual({ itemId: 'PVTI_new', existed: false });
  });
});

describe('setFieldValue', () => {
  it('maps each FieldValueInput kind to the correct GraphQL value shape', async () => {
    mockUserScopes(['repo', 'project']);
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      expect(body.variables.value).toEqual({ singleSelectOptionId: 'OPT_done' });
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } };
    });

    const result = await setFieldValue({
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      itemId: 'PVTI_1',
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });
    expect(result.itemId).toBe('PVTI_1');
  });

  it.each([
    [{ kind: 'text', text: 'hello' } as const, { text: 'hello' }],
    [{ kind: 'number', number: 5 } as const, { number: 5 }],
    [{ kind: 'date', date: '2026-07-03' } as const, { date: '2026-07-03' }],
    [{ kind: 'iteration', iterationId: 'IT_1' } as const, { iterationId: 'IT_1' }],
  ])('maps %o to %o', async (value, expected) => {
    mockUserScopes(['repo', 'project']);
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      expect(body.variables.value).toEqual(expected);
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } };
    });
    await setFieldValue({ projectOwnerLogin: 'acme', projectNumber: 4, itemId: 'PVTI_1', fieldId: 'PVTF_x', value });
  });
});

describe('getProjectItems', () => {
  it('flattens item field-value fragments into a uniform shape', async () => {
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return {
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: 'PVTI_1',
                content: { title: 'Ship the thing', number: 9, repository: { nameWithOwner: 'acme/widgets' } },
                fieldValues: {
                  nodes: [
                    { text: undefined, name: 'In Progress', field: { name: 'Status' } },
                    { number: 5, field: { name: 'Story Points' } },
                  ],
                },
              },
            ],
          },
        },
      };
    });

    // getProjectItems resolves the project ID via a node(id:) lookup, so it
    // must also see a projectV2(number ...) call from resolveProjectNodeId.
    const result = await getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(result.items).toEqual([
      {
        id: 'PVTI_1',
        title: 'Ship the thing',
        number: 9,
        repo: 'acme/widgets',
        fieldValues: [
          { fieldName: 'Status', text: undefined, number: undefined, date: undefined, optionName: 'In Progress' },
          { fieldName: 'Story Points', text: undefined, number: 5, date: undefined, optionName: undefined },
        ],
      },
    ]);
  });

  it('Edge Case: a DraftIssue item has no number or repo, not an error', async () => {
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return {
        node: {
          items: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: 'PVTI_2', content: { title: 'A draft idea' }, fieldValues: { nodes: [] } }],
          },
        },
      };
    });

    const result = await getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(result.items).toEqual([{ id: 'PVTI_2', title: 'A draft idea', number: null, repo: null, fieldValues: [] }]);
  });

  it('gdlc#200 regression: paginates past a 100-item first page instead of silently dropping the rest', async () => {
    // Mirrors the live-confirmed shape: the org's real board has 235 items;
    // this proves a >100-item board (here, 150 across 2 pages) is returned
    // in full, not just page 1 -- the exact bug that produced
    // sync_linked_issues_project_field's false-negative notFoundOnBoard for
    // issues #319-323 in session 1f3d575b.
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `PVTI_${i}`,
      content: { title: `Item ${i}`, number: i, repository: { nameWithOwner: 'acme/widgets' } },
      fieldValues: { nodes: [] },
    }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({
      id: `PVTI_${100 + i}`,
      content: { title: `Item ${100 + i}`, number: 100 + i, repository: { nameWithOwner: 'acme/widgets' } },
      fieldValues: { nodes: [] },
    }));
    let pageQueries = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      pageQueries += 1;
      if (body.variables.after === undefined || body.variables.after === null) {
        return { node: { items: { pageInfo: { hasNextPage: true, endCursor: 'CURSOR_PAGE_2' }, nodes: page1 } } };
      }
      expect(body.variables.after).toBe('CURSOR_PAGE_2');
      return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: page2 } } };
    });

    const result = await getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(pageQueries).toBe(2);
    expect(result.items).toHaveLength(150);
    // The specific item that would previously be silently dropped:
    expect(result.items.find((i) => i.number === 123)).toBeDefined();
  });

  it('code-review finding: throws rather than looping forever when hasNextPage never becomes false', async () => {
    // Simulates a malformed/buggy GraphQL response (a stale or repeating
    // endCursor). Without a page cap, this would hang the calling MCP tool
    // and burn API rate limit indefinitely instead of surfacing an error.
    let calls = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      calls += 1;
      return { node: { items: { pageInfo: { hasNextPage: true, endCursor: `CURSOR_${calls}` }, nodes: [] } } };
    });

    await expect(getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 })).rejects.toThrow(/exceeded \d+ pages/);
    // One call per page, up to the cap -- proves it actually stopped
    // rather than looping past it.
    expect(calls).toBe(1000);
  });

  it('Copilot review finding: throws a clear error rather than a confusing TypeError when pageInfo is missing on a present items page', async () => {
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      // Malformed/unexpected response: items present, pageInfo absent.
      return { node: { items: { nodes: [{ id: 'PVTI_1', content: null, fieldValues: { nodes: [] } }] } } };
    });

    await expect(getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 })).rejects.toThrow(/malformed response.*pageInfo missing/);
  });

  // gdlc#283 round-2 finding, back-ported here since gdlc#282 gives
  // fetchAllProjectItemNodes a second caller (addItemToProject).
  it('gdlc#283 round-2 finding: throws immediately when hasNextPage is true but endCursor never advances', async () => {
    let calls = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      calls += 1;
      return { node: { items: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } } };
    });

    await expect(getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 })).rejects.toThrow(/endCursor did not advance/);
    expect(calls).toBe(1);
  });

  it('does not throw when node.items itself is entirely absent (project not found / no access)', async () => {
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return { node: {} };
    });

    const result = await getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(result.items).toEqual([]);
  });
});

describe('getProjectStatusProfile', () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  function isolate(): void {
    process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'gdlc-status-profile-'));
  }

  it('fetches the Status field schema, computes missing stages, and persists to the XDG cache', async () => {
    isolate();
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      expect(body.query).toContain('field(name: "Status")');
      return {
        node: {
          field: {
            id: 'PVTSSF_status',
            name: 'Status',
            options: [
              { id: 'a', name: 'Todo' },
              { id: 'b', name: 'In Progress' },
              { id: 'c', name: 'In Review' },
              { id: 'd', name: 'Blocked' },
              { id: 'e', name: 'Done' },
            ],
          },
        },
      };
    });

    const profile = await getProjectStatusProfile({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(profile.statusField?.options).toHaveLength(5);
    expect(profile.missingLifecycleStages).toEqual(['Backlog', 'Ready']);

    const cached = readProjectProfile('acme', 4);
    expect(cached).toEqual(profile);
  });

  it('caches null when the board has no Status field, without throwing', async () => {
    isolate();
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return { node: {} };
    });

    const profile = await getProjectStatusProfile({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(profile.statusField).toBeNull();
    expect(profile.missingLifecycleStages).toEqual(['Backlog', 'Ready', 'In Progress', 'In Review', 'Done']);
  });

  it('serves a fresh cached profile without issuing another GraphQL call', async () => {
    isolate();
    let fieldQueryCalls = 0;
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      fieldQueryCalls += 1;
      return { node: { field: { id: 'PVTSSF_status', name: 'Status', options: [{ id: 'a', name: 'Done' }] } } };
    });

    await getProjectStatusProfile({ projectOwnerLogin: 'acme', projectNumber: 4 });
    await getProjectStatusProfile({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(fieldQueryCalls).toBe(1);
  });
});
