import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { addSubIssue, listSubIssues, MAX_SUB_ISSUES_PER_PARENT, MAX_NESTING_LEVELS } from '../../src/tools/sub-issues.js';

function issueLookup(nodeId: string) {
  return { node_id: nodeId };
}

describe('addSubIssue', () => {
  it('AC-2: rejects with limit_exceeded when the parent already has 100 sub-issues, without calling GitHub', async () => {
    mockRest('get', '/repos/acme/widgets/issues/1', issueLookup('I_parent'));
    mockRest('get', '/repos/acme/widgets/issues/2', issueLookup('I_child'));
    let mutationCalled = false;
    mockGraphQL((body) => {
      if (body.query.includes('subIssuesSummary')) {
        return { node: { subIssuesSummary: { total: MAX_SUB_ISSUES_PER_PARENT } } };
      }
      if (body.query.includes('parent {')) {
        // ISSUE_PARENT_QUERY (level check) — top-level parent.
        return { node: { parent: null } };
      }
      mutationCalled = true;
      return { addSubIssue: { issue: { id: 'I_parent' }, subIssue: { id: 'I_child' } } };
    });

    await expect(
      addSubIssue({ owner: 'acme', repo: 'widgets', parentNumber: 1, childNumber: 2 }),
    ).rejects.toMatchObject({ code: 'limit_exceeded', details: { limit: 'max_sub_issues_per_parent' } });
    expect(mutationCalled).toBe(false);
  });

  it('AC-2: rejects with limit_exceeded when adding would exceed 8 nesting levels', async () => {
    mockRest('get', '/repos/acme/widgets/issues/1', issueLookup('I_L8'));
    mockRest('get', '/repos/acme/widgets/issues/2', issueLookup('I_child'));
    let hop = 0;
    mockGraphQL((body) => {
      if (body.query.includes('subIssuesSummary') && !body.query.includes('parent {')) {
        return { node: { subIssuesSummary: { total: 0 } } };
      }
      if (body.query.includes('parent {')) {
        // Simulate a chain exactly at the 8-level limit: 7 ancestors above
        // the parent (parent itself is level 8).
        hop += 1;
        if (hop <= 7) return { node: { parent: { id: `I_ancestor_${hop}` } } };
        return { node: { parent: null } };
      }
      throw new Error(`unexpected query: ${body.query}`);
    });

    await expect(
      addSubIssue({ owner: 'acme', repo: 'widgets', parentNumber: 1, childNumber: 2 }),
    ).rejects.toMatchObject({ code: 'limit_exceeded', details: { limit: 'max_nesting_levels', max: MAX_NESTING_LEVELS } });
  });

  it('Edge Case: uses replaceParent so a concurrent re-parent call succeeds cleanly', async () => {
    mockRest('get', '/repos/acme/widgets/issues/1', issueLookup('I_parent'));
    mockRest('get', '/repos/acme/widgets/issues/2', issueLookup('I_child'));
    let sawReplaceParent: unknown;
    mockGraphQL((body) => {
      if (body.query.includes('subIssuesSummary')) return { node: { subIssuesSummary: { total: 2 } } };
      if (body.query.includes('parent {')) return { node: { parent: null } };
      sawReplaceParent = body.variables.replaceParent;
      return { addSubIssue: { issue: { id: 'I_parent' }, subIssue: { id: 'I_child' } } };
    });

    const result = await addSubIssue({ owner: 'acme', repo: 'widgets', parentNumber: 1, childNumber: 2 });
    expect(sawReplaceParent).toBe(true);
    expect(result.replacedParent).toBe(true);
  });
});

describe('listSubIssues', () => {
  it('returns the summary and item list', async () => {
    mockGraphQL(() => ({
      repository: {
        issue: {
          subIssuesSummary: { total: 2, completed: 1, percentCompleted: 50 },
          subIssues: {
            nodes: [
              { id: 'I_a', number: 10, title: 'A', state: 'CLOSED' },
              { id: 'I_b', number: 11, title: 'B', state: 'OPEN' },
            ],
          },
        },
      },
    }));

    const result = await listSubIssues({ owner: 'acme', repo: 'widgets', parentNumber: 1 });
    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ number: 10, nodeId: 'I_a', title: 'A', state: 'CLOSED' });
  });
});
