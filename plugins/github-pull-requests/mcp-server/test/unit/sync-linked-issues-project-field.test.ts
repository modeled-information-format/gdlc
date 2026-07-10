import { describe, it, expect } from 'vitest';
import { mockGraphQL, mockRest, mockUserScopes } from '../helpers.js';
import { syncLinkedIssuesProjectField } from '../../src/tools/sync-linked-issues-project-field.js';

const projectQueryResponses = (items: Array<{ id: string; number: number; repo?: string }>) => ({
  node: {
    items: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: items.map((i) => ({
        id: i.id,
        content: { title: `issue ${i.number}`, number: i.number, repository: { nameWithOwner: i.repo ?? 'acme/widgets' } },
        fieldValues: { nodes: [] },
      })),
    },
  },
});

describe('syncLinkedIssuesProjectField', () => {
  it('Edge Case: rejects an unmerged PR with not_merged, before touching linked issues or Projects', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/1', { merged: false });
    await expect(
      syncLinkedIssuesProjectField({
        owner: 'acme',
        repo: 'widgets',
        pullNumber: 1,
        projectOwnerLogin: 'acme',
        projectNumber: 4,
        fieldId: 'PVTF_status',
        value: { kind: 'singleSelect', optionId: 'OPT_done' },
      }),
    ).rejects.toMatchObject({ code: 'not_merged' });
  });

  // Must run before any test below that completes a successful project-scope
  // check (e.g. "syncs the project field..."): github-sdlc-planning's
  // assertProjectScope caches its result in a module-level flag this plugin
  // has no way to reset (not exported), so once that flag flips true within
  // this file's single module load, later calls short-circuit past the
  // /user check regardless of what mockUserScopes sets up.
  it('Edge Case: preserves missing_scope from set_field_value rather than collapsing it to resolve_id_failed', async () => {
    mockUserScopes(['repo']);
    mockRest('get', '/repos/acme/widgets/pulls/10', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #11',
              closingIssuesReferences: { nodes: [{ number: 11, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return projectQueryResponses([{ id: 'PVTI_11', number: 11 }]);
    });
    mockRest('get', '/repos/acme/widgets/issues/11', { body: 'plain' });

    await expect(
      syncLinkedIssuesProjectField({
        owner: 'acme',
        repo: 'widgets',
        pullNumber: 10,
        projectOwnerLogin: 'acme',
        projectNumber: 4,
        fieldId: 'PVTF_status',
        value: { kind: 'singleSelect', optionId: 'OPT_done' },
      }),
    ).rejects.toMatchObject({ code: 'missing_scope', details: { missingScope: 'project' } });
  });

  it('syncs the project field for every closing linked issue found on the board', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/pulls/2', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #7',
              closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('items(first')) return projectQueryResponses([{ id: 'PVTI_7', number: 7 }]);
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_7' } } };
    });
    mockRest('get', '/repos/acme/widgets/issues/7', { body: 'plain' });

    const result = await syncLinkedIssuesProjectField({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 2,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });

    expect(result.synced).toEqual([{ issueNumber: 7, itemId: 'PVTI_7' }]);
    expect(result.notFoundOnBoard).toEqual([]);
    expect(result.skippedCrossRepo).toEqual([]);
  });

  it('Edge Case: skips a closing issue in a different repo rather than risking a wrong-item match', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/5', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes acme/other-repo#7',
              closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: 'acme/other-repo' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      // Board happens to have an item numbered 7 too — from a different
      // repo's issue #7, not the one this PR closes. It must never be
      // touched: no set_field_value call is mocked, so one would fail loudly.
      return projectQueryResponses([{ id: 'PVTI_WRONG', number: 7, repo: 'acme/other-repo' }]);
    });
    mockRest('get', '/repos/acme/other-repo/issues/7', { body: 'plain' });

    const result = await syncLinkedIssuesProjectField({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 5,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });

    expect(result.synced).toEqual([]);
    expect(result.notFoundOnBoard).toEqual([]);
    expect(result.skippedCrossRepo).toEqual([7]);
  });

  it('Edge Case: does not match a same-repo closing issue to a same-numbered board item from a different repo', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/pulls/6', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #7',
              closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      // The board's only item numbered 7 belongs to a different repo. It
      // must never be touched: no set_field_value call is mocked, so one
      // would fail loudly. The real acme/widgets#7 simply isn't on this
      // board.
      return projectQueryResponses([{ id: 'PVTI_WRONG', number: 7, repo: 'acme/other-repo' }]);
    });
    mockRest('get', '/repos/acme/widgets/issues/7', { body: 'plain' });

    const result = await syncLinkedIssuesProjectField({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 6,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });

    expect(result.synced).toEqual([]);
    expect(result.notFoundOnBoard).toEqual([7]);
    expect(result.skippedCrossRepo).toEqual([]);
  });

  it('Edge Case: reports a closing issue not present on the board as notFoundOnBoard, not an error', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/3', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #8',
              closingIssuesReferences: { nodes: [{ number: 8, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return projectQueryResponses([]);
    });
    mockRest('get', '/repos/acme/widgets/issues/8', { body: 'plain' });

    const result = await syncLinkedIssuesProjectField({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 3,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });

    expect(result.synced).toEqual([]);
    expect(result.notFoundOnBoard).toEqual([8]);
    expect(result.skippedCrossRepo).toEqual([]);
  });

  it('gdlc#200 regression: finds and syncs a closing issue on page 2 of a >100-item board (not notFoundOnBoard)', async () => {
    // Reproduces the live-confirmed bug: session 1f3d575b's PR #370/#371
    // against the org's real 235-item board got notFoundOnBoard for issues
    // #319-323, purely because get_project_items only ever fetched page 1.
    mockRest('get', '/repos/acme/widgets/pulls/9', { merged: true });
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `PVTI_${i}`,
      content: { title: `issue ${i}`, number: i, repository: { nameWithOwner: 'acme/widgets' } },
      fieldValues: { nodes: [] },
    }));
    const page2Item = {
      id: 'PVTI_123',
      content: { title: 'issue 123', number: 123, repository: { nameWithOwner: 'acme/widgets' } },
      fieldValues: { nodes: [] },
    };
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #123',
              closingIssuesReferences: { nodes: [{ number: 123, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('items(first')) {
        if (body.variables.after === undefined || body.variables.after === null) {
          return { node: { items: { pageInfo: { hasNextPage: true, endCursor: 'CURSOR_2' }, nodes: page1 } } };
        }
        return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [page2Item] } } };
      }
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_123' } } };
    });
    mockRest('get', '/repos/acme/widgets/issues/123', { body: 'plain' });

    const result = await syncLinkedIssuesProjectField({
      owner: 'acme',
      repo: 'widgets',
      pullNumber: 9,
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      fieldId: 'PVTF_status',
      value: { kind: 'singleSelect', optionId: 'OPT_done' },
    });

    expect(result.notFoundOnBoard).toEqual([]);
    expect(result.synced).toEqual([{ issueNumber: 123, itemId: 'PVTI_123' }]);
  });

  it('Edge Case: wraps a get_project_items failure (project not found) as resolve_id_failed, not a bare PlanningError', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/4', { merged: true });
    mockGraphQL((body) => {
      if (body.query.includes('closingIssuesReferences')) {
        return {
          repository: {
            pullRequest: {
              body: 'Fixes #9',
              closingIssuesReferences: { nodes: [{ number: 9, repository: { nameWithOwner: 'acme/widgets' } }] },
            },
          },
        };
      }
      // projectV2(number lookup inside get_project_items's resolveProjectNodeId — project not found.
      return { organization: { projectV2: null } };
    });
    mockRest('get', '/repos/acme/widgets/issues/9', { body: 'plain' });

    await expect(
      syncLinkedIssuesProjectField({
        owner: 'acme',
        repo: 'widgets',
        pullNumber: 4,
        projectOwnerLogin: 'acme',
        projectNumber: 999,
        fieldId: 'PVTF_status',
        value: { kind: 'singleSelect', optionId: 'OPT_done' },
      }),
    ).rejects.toMatchObject({ code: 'resolve_id_failed', details: { lookupStep: 'get_project_items' } });
  });
});
