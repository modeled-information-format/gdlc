import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockGraphQL, mockRest, mockUserScopes, type GraphQLRequestBody } from '../helpers.js';
import {
  getLifecycleState,
  setLifecycleState,
  searchSimilarIssues,
  closeAsDuplicate,
} from '../../src/tools/lifecycle.js';

const STATUS_OPTIONS = [
  { id: 'OPT_todo', name: 'Todo' },
  { id: 'OPT_in_progress', name: 'In Progress' },
  { id: 'OPT_done', name: 'Done' },
];

const COORDS = { projectOwnerLogin: 'acme', projectNumber: 4 } as const;

function routeProject(body: GraphQLRequestBody): unknown | undefined {
  if (body.query.includes('organization(login')) return { organization: { projectV2: { id: 'PVT_1' } } };
  if (body.query.includes('user(login')) return { user: { projectV2: { id: 'PVT_u' } } };
  return undefined;
}

describe('getLifecycleState', () => {
  const INPUT = { owner: 'acme', repo: 'widgets', issueNumber: 9, ...COORDS };

  it('reports native state and Status value when the issue is on the board', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return {
        repository: {
          issue: {
            state: 'OPEN',
            projectItems: {
              nodes: [{ project: { id: 'PVT_1' }, fieldValueByName: { name: 'In Progress' } }],
            },
          },
        },
      };
    });

    const result = await getLifecycleState(INPUT);

    expect(result).toEqual({ issueNumber: 9, nativeState: 'open', onBoard: true, status: 'In Progress' });
  });

  it('reports closed native state', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return { repository: { issue: { state: 'CLOSED', projectItems: { nodes: [] } } } };
    });

    const result = await getLifecycleState(INPUT);
    expect(result.nativeState).toBe('closed');
  });

  it('reports onBoard: false and status: null when the issue has no item on this project', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return {
        repository: {
          issue: { state: 'OPEN', projectItems: { nodes: [{ project: { id: 'PVT_other' }, fieldValueByName: null }] } },
        },
      };
    });

    const result = await getLifecycleState(INPUT);
    expect(result).toEqual({ issueNumber: 9, nativeState: 'open', onBoard: false, status: null });
  });

  it('reports status: null when the issue is on the board but the Status field has no value (or does not exist)', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return {
        repository: {
          issue: { state: 'OPEN', projectItems: { nodes: [{ project: { id: 'PVT_1' }, fieldValueByName: null }] } },
        },
      };
    });

    const result = await getLifecycleState(INPUT);
    expect(result).toEqual({ issueNumber: 9, nativeState: 'open', onBoard: true, status: null });
  });

  it('fails with resolve_issue_id when the issue does not exist', async () => {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      return { repository: { issue: null } };
    });
    await expect(getLifecycleState(INPUT)).rejects.toMatchObject({ code: 'resolve_issue_id' });
  });
});

describe('setLifecycleState', () => {
  // Mutates the board's Status field, so it asserts the project OAuth scope
  // first, same as setSeverity; grant it by default here too.
  beforeEach(() => mockUserScopes(['repo', 'project']));

  const INPUT = { owner: 'acme', repo: 'widgets', issueNumber: 9, ...COORDS, status: 'Done' };

  function mockBoard(overrides: {
    projectItems?: Array<{ id: string; project: { id: string } }>;
    fields?: unknown[];
    issue?: null;
    onUpdate?: (vars: Record<string, unknown>) => void;
  }): void {
    mockGraphQL((body) => {
      const routed = routeProject(body);
      if (routed) return routed;
      if (body.query.includes('projectItems(first')) {
        if (overrides.issue === null) return { repository: { issue: null } };
        return { repository: { issue: { projectItems: { nodes: overrides.projectItems ?? [{ id: 'PVTI_9', project: { id: 'PVT_1' } }] } } } };
      }
      if (body.query.includes('fields(first')) {
        return {
          node: {
            fields: {
              nodes: overrides.fields ?? [{ __typename: 'ProjectV2SingleSelectField', id: 'F_status', name: 'Status', options: STATUS_OPTIONS }],
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

  it('sets the Status option and does not close the issue by default', async () => {
    let updateVars: Record<string, unknown> | undefined;
    mockBoard({ onUpdate: (vars) => { updateVars = vars; } });

    const result = await setLifecycleState(INPUT);

    expect(result).toEqual({ itemId: 'PVTI_9', fieldId: 'F_status', optionId: 'OPT_done', status: 'Done', closed: false });
    expect(updateVars).toEqual({ projectId: 'PVT_1', itemId: 'PVTI_9', fieldId: 'F_status', optionId: 'OPT_done' });
  });

  it('closes the issue via REST PATCH when closeIfDone is true', async () => {
    mockBoard({});
    let patchBody: unknown;
    server.use(
      http.patch('https://api.github.com/repos/acme/widgets/issues/9', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ number: 9, state: 'closed' });
      }),
    );

    const result = await setLifecycleState({ ...INPUT, closeIfDone: true });

    expect(result.closed).toBe(true);
    expect(patchBody).toEqual({ state: 'closed' });
  });

  it('fails with resolve_issue_id when the issue does not exist', async () => {
    mockBoard({ issue: null });
    await expect(setLifecycleState(INPUT)).rejects.toMatchObject({ code: 'resolve_issue_id' });
  });

  it('fails with issue_not_on_board when the issue has no item on this project', async () => {
    mockBoard({ projectItems: [{ id: 'PVTI_other', project: { id: 'PVT_other' } }] });
    await expect(setLifecycleState(INPUT)).rejects.toMatchObject({ code: 'issue_not_on_board' });
  });

  it('fails with missing_field when the board has no Status single-select field', async () => {
    mockBoard({ fields: [{ __typename: 'ProjectV2Field', id: 'F_other', name: 'Other' }] });
    await expect(setLifecycleState(INPUT)).rejects.toMatchObject({ code: 'missing_field' });
  });

  it('fails with missing_option when the Status field lacks the requested value', async () => {
    mockBoard({
      fields: [{ __typename: 'ProjectV2SingleSelectField', id: 'F_status', name: 'Status', options: [{ id: 'OPT_todo', name: 'Todo' }] }],
    });
    await expect(setLifecycleState(INPUT)).rejects.toMatchObject({
      code: 'missing_option',
      details: expect.objectContaining({ available: ['Todo'] }),
    });
  });
});

describe('searchSimilarIssues', () => {
  it('returns candidates and total count from the REST search endpoint', async () => {
    mockRest('get', '/search/issues', {
      total_count: 2,
      items: [
        { number: 5, title: 'Crash on save', state: 'open', html_url: 'https://github.com/acme/widgets/issues/5' },
        { number: 3, title: 'Crash on save (old)', state: 'closed', html_url: 'https://github.com/acme/widgets/issues/3' },
      ],
    });

    const result = await searchSimilarIssues({ owner: 'acme', repo: 'widgets', query: 'crash on save' });

    expect(result).toEqual({
      totalCount: 2,
      candidates: [
        { number: 5, title: 'Crash on save', state: 'open', htmlUrl: 'https://github.com/acme/widgets/issues/5' },
        { number: 3, title: 'Crash on save (old)', state: 'closed', htmlUrl: 'https://github.com/acme/widgets/issues/3' },
      ],
    });
  });

  it('returns an empty candidate list when the search has zero results', async () => {
    mockRest('get', '/search/issues', { total_count: 0, items: [] });
    const result = await searchSimilarIssues({ owner: 'acme', repo: 'widgets', query: 'nonexistent-symptom' });
    expect(result).toEqual({ totalCount: 0, candidates: [] });
  });
});

describe('closeAsDuplicate', () => {
  it('closes the issue with state_reason duplicate and comments linking to the canonical issue', async () => {
    let patchBody: unknown;
    let commentBody: unknown;
    server.use(
      http.patch('https://api.github.com/repos/acme/widgets/issues/9', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ number: 9, state: 'closed', state_reason: 'duplicate' });
      }),
      http.post('https://api.github.com/repos/acme/widgets/issues/9/comments', async ({ request }) => {
        commentBody = await request.json();
        return HttpResponse.json({ html_url: 'https://github.com/acme/widgets/issues/9#issuecomment-1' }, { status: 201 });
      }),
    );

    const result = await closeAsDuplicate({ owner: 'acme', repo: 'widgets', issueNumber: 9, duplicateOfNumber: 3 });

    expect(patchBody).toEqual({ state: 'closed', state_reason: 'duplicate' });
    expect(commentBody).toEqual({ body: 'Closing as a duplicate of #3.' });
    expect(result).toEqual({
      issueNumber: 9,
      duplicateOfNumber: 3,
      state: 'closed',
      stateReason: 'duplicate',
      commentUrl: 'https://github.com/acme/widgets/issues/9#issuecomment-1',
    });
  });
});
