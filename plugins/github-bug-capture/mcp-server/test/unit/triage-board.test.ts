import { describe, it, expect, beforeEach } from 'vitest';
import { mockGraphQL, mockUserScopes, type GraphQLRequestBody } from '../helpers.js';
import { ensureSeverityField, setSeverity, SEVERITY_LEVELS } from '../../src/tools/triage-board.js';

// Every tool call here now asserts the project OAuth scope first (test/unit/
// github-client.test.ts covers that check's own behavior in isolation);
// grant it by default so these tests exercise the triage-board logic, not
// the preflight.
beforeEach(() => mockUserScopes(['repo', 'project']));

const SEVERITY_OPTIONS = [
  { id: 'OPT_critical', name: 'Critical' },
  { id: 'OPT_high', name: 'High' },
  { id: 'OPT_medium', name: 'Medium' },
  { id: 'OPT_low', name: 'Low' },
];

const COORDS = { projectOwnerLogin: 'acme', projectNumber: 4 } as const;

/** Route the several GraphQL round-trips a tool call makes by query shape. */
function routeProject(body: GraphQLRequestBody): unknown | undefined {
  if (body.query.includes('organization(login')) return { organization: { projectV2: { id: 'PVT_1' } } };
  if (body.query.includes('user(login')) return { user: { projectV2: { id: 'PVT_u' } } };
  return undefined;
}

describe('ensureSeverityField', () => {
  it('creates the Severity single-select field with the canonical options when absent', async () => {
    let createVars: Record<string, unknown> | undefined;
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('fields(first')) return { node: { fields: { nodes: [{ __typename: 'ProjectV2Field', id: 'F_status', name: 'Status' }] } } };
      if (body.query.includes('createProjectV2Field')) {
        createVars = body.variables;
        return { createProjectV2Field: { projectV2Field: { id: 'F_sev', name: 'Severity', options: SEVERITY_OPTIONS } } };
      }
      throw new Error(`unexpected query: ${body.query}`);
    });

    const result = await ensureSeverityField(COORDS);

    expect(result).toEqual({ fieldId: 'F_sev', created: true, options: SEVERITY_OPTIONS });
    expect(createVars?.projectId).toBe('PVT_1');
    expect(createVars?.options).toEqual(
      SEVERITY_LEVELS.map((name) => expect.objectContaining({ name })),
    );
  });

  it('is idempotent: an existing Severity field is returned with its option IDs, no mutation issued', async () => {
    let mutationCalls = 0;
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('fields(first')) {
        return { node: { fields: { nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_sev', name: 'Severity', options: SEVERITY_OPTIONS }] } } };
      }
      mutationCalls += 1;
      return {};
    });

    const result = await ensureSeverityField(COORDS);

    expect(result).toEqual({ fieldId: 'F_sev', created: false, options: SEVERITY_OPTIONS });
    expect(mutationCalls).toBe(0);
  });

  it('resolves a user-owned project through the user(login) query', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return { node: { fields: { nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_sev', name: 'Severity', options: SEVERITY_OPTIONS }] } } };
    });
    const result = await ensureSeverityField({ ...COORDS, projectOwnerType: 'user' });
    expect(result.created).toBe(false);
  });

  it('fails with field_type_conflict when Severity exists but is not single-select', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return { node: { fields: { nodes: [{ __typename: 'ProjectV2Field', id: 'F_text', name: 'Severity' }] } } };
    });
    await expect(ensureSeverityField(COORDS)).rejects.toMatchObject({ code: 'field_type_conflict' });
  });

  it('fails with resolve_project_id when the project does not exist', async () => {
    mockGraphQL(() => ({ organization: { projectV2: null } }));
    await expect(ensureSeverityField(COORDS)).rejects.toMatchObject({ code: 'resolve_project_id' });
  });
});

describe('setSeverity', () => {
  const INPUT = { owner: 'acme', repo: 'widgets', issueNumber: 9, ...COORDS, severity: 'High' } as const;

  const DEFAULT_ITEM = { id: 'PVTI_9', content: { number: 9, repository: { nameWithOwner: 'acme/widgets' } }, fieldValueByName: null };

  function mockBoard(overrides: {
    items?: Array<{ id: string; content: { number: number; repository: { nameWithOwner: string } }; fieldValueByName?: { name: string } | null }>;
    fields?: unknown[];
    issueExists?: boolean;
    onUpdate?: (vars: Record<string, unknown>) => void;
  }): void {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('issue(number: $number) { id }')) {
        return overrides.issueExists === false ? { repository: { issue: null } } : { repository: { issue: { id: 'I_9' } } };
      }
      if (body.query.includes('items(first: 100, after')) {
        return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: overrides.items ?? [DEFAULT_ITEM] } } };
      }
      if (body.query.includes('fields(first')) {
        return {
          node: {
            fields: {
              nodes: overrides.fields ?? [{ __typename: 'ProjectV2SingleSelectField', id: 'F_sev', name: 'Severity', options: SEVERITY_OPTIONS }],
            },
          },
        };
      }
      if (body.query.includes('updateProjectV2ItemFieldValue')) {
        overrides.onUpdate?.(body.variables);
        return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_9' } } };
      }
      throw new Error(`unexpected query: ${body.query}`);
    });
  }

  it('resolves the board item through the project items connection and sets the option', async () => {
    let updateVars: Record<string, unknown> | undefined;
    mockBoard({
      items: [
        { id: 'PVTI_other', content: { number: 99, repository: { nameWithOwner: 'acme/widgets' } } },
        DEFAULT_ITEM,
      ],
      onUpdate: (vars) => {
        updateVars = vars;
      },
    });

    const result = await setSeverity(INPUT);

    expect(result).toEqual({ itemId: 'PVTI_9', fieldId: 'F_sev', optionId: 'OPT_high', severity: 'High' });
    expect(updateVars).toEqual({ projectId: 'PVT_1', itemId: 'PVTI_9', fieldId: 'F_sev', optionId: 'OPT_high' });
  });

  // Issue #273: the board item lookup used to go through the issue's own
  // projectItems connection, which was confirmed to silently omit items on a
  // project owned by a different entity than the issue's repo. This test
  // guards the fix by asserting the item resolves via the project's own
  // items connection, not the (now-removed) issue-side one.
  it('resolves the board item even when it lives on a user-owned project (issue #273 regression)', async () => {
    mockBoard({ items: [DEFAULT_ITEM] });
    const result = await setSeverity({ ...INPUT, projectOwnerType: 'user' });
    expect(result.itemId).toBe('PVTI_9');
  });

  it('fails with resolve_issue_id when the issue does not exist', async () => {
    mockBoard({ issueExists: false });
    await expect(setSeverity(INPUT)).rejects.toMatchObject({ code: 'resolve_issue_id' });
  });

  it('fails with issue_not_on_board when the issue has no item on this project', async () => {
    mockBoard({ items: [{ id: 'PVTI_other', content: { number: 99, repository: { nameWithOwner: 'acme/widgets' } } }] });
    await expect(setSeverity(INPUT)).rejects.toMatchObject({ code: 'issue_not_on_board' });
  });

  it('fails with missing_field when the board has no Severity single-select field', async () => {
    mockBoard({ fields: [{ __typename: 'ProjectV2Field', id: 'F_status', name: 'Status' }] });
    await expect(setSeverity(INPUT)).rejects.toMatchObject({ code: 'missing_field' });
  });

  it('fails with missing_option when the Severity field lacks the requested level', async () => {
    mockBoard({
      fields: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_sev', name: 'Severity', options: [{ id: 'OPT_low', name: 'Low' }] }],
    });
    await expect(setSeverity(INPUT)).rejects.toMatchObject({
      code: 'missing_option',
      details: expect.objectContaining({ available: ['Low'] }),
    });
  });

  it('applies mutation pacing to the updateProjectV2ItemFieldValue call', async () => {
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    mockBoard({});
    await setSeverity(INPUT, { sleep });
    await setSeverity(INPUT, { sleep });
    // The reads are unpaced; only the second call's mutation has to wait out
    // the 1000ms window opened by the first call's mutation.
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
  });

  // Copilot review finding on PR #283: GraphQL accepts mixed-case owner/repo
  // in queries, but nameWithOwner comes back in GitHub's canonical casing --
  // a case-sensitive match would reintroduce a false issue_not_on_board for
  // an issue that genuinely is on the board, just triggered by input casing.
  it('matches the board item case-insensitively against owner/repo (Copilot review finding)', async () => {
    mockBoard({ items: [{ id: 'PVTI_9', content: { number: 9, repository: { nameWithOwner: 'Acme/Widgets' } } }] });
    const result = await setSeverity({ ...INPUT, owner: 'acme', repo: 'widgets' });
    expect(result.itemId).toBe('PVTI_9');
  });

  // Mirrors github-sdlc-planning/projects.ts's equivalent coverage for the
  // same paginated-scan shape (gdlc#200's fix), since findProjectItemForContent
  // (project-board.ts) reuses that pattern for issue #273's fix.
  it('paginates past a 100-item first page to find a match on a later page', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      id: `PVTI_other_${i}`,
      content: { number: 1000 + i, repository: { nameWithOwner: 'acme/widgets' } },
    }));
    let pageQueries = 0;
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('issue(number: $number) { id }')) return { repository: { issue: { id: 'I_9' } } };
      if (body.query.includes('items(first: 100, after')) {
        pageQueries += 1;
        if (body.variables.after === undefined || body.variables.after === null) {
          return { node: { items: { pageInfo: { hasNextPage: true, endCursor: 'CURSOR_PAGE_2' }, nodes: page1 } } };
        }
        expect(body.variables.after).toBe('CURSOR_PAGE_2');
        return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [DEFAULT_ITEM] } } };
      }
      if (body.query.includes('fields(first')) {
        return { node: { fields: { nodes: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_sev', name: 'Severity', options: SEVERITY_OPTIONS }] } } };
      }
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_9' } } };
    });

    const result = await setSeverity(INPUT);
    expect(pageQueries).toBe(2);
    expect(result.itemId).toBe('PVTI_9');
  });

  it('throws rather than looping forever when hasNextPage never becomes false', async () => {
    let calls = 0;
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('issue(number: $number) { id }')) return { repository: { issue: { id: 'I_9' } } };
      if (body.query.includes('items(first: 100, after')) {
        calls += 1;
        return { node: { items: { pageInfo: { hasNextPage: true, endCursor: `CURSOR_${calls}` }, nodes: [] } } };
      }
      throw new Error(`unexpected query: ${body.query}`);
    });

    await expect(setSeverity(INPUT)).rejects.toThrow(/exceeded \d+ pages/);
    expect(calls).toBe(1000);
  });

  it('throws a clear error rather than a confusing TypeError when pageInfo is missing on a present items page', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('issue(number: $number) { id }')) return { repository: { issue: { id: 'I_9' } } };
      if (body.query.includes('items(first: 100, after')) {
        return { node: { items: { nodes: [{ id: 'PVTI_1', content: null, fieldValueByName: null }] } } };
      }
      throw new Error(`unexpected query: ${body.query}`);
    });

    await expect(setSeverity(INPUT)).rejects.toThrow(/malformed response.*pageInfo missing/);
  });
});
