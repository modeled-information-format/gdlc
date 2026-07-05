import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL, mockUserScopes } from '../helpers.js';
import { addItemToProject, setFieldValue, getProjectItems } from '../../src/tools/projects.js';

describe('addItemToProject', () => {
  it('AC-3: resolves the issue and project node IDs before mutating, never a numeric ID', async () => {
    mockUserScopes(['repo', 'project']);
    mockRest('get', '/repos/acme/widgets/issues/9', { node_id: 'I_9' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (body.query.includes('projectItems')) {
        return { repository: { issue: { projectItems: { nodes: [] } } } };
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
      if (body.query.includes('projectItems')) {
        return {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  { id: 'PVTI_other', project: { id: 'PVT_other' } },
                  { id: 'PVTI_existing', project: { id: 'PVT_1' } },
                ],
              },
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
            nodes: [{ id: 'PVTI_2', content: { title: 'A draft idea' }, fieldValues: { nodes: [] } }],
          },
        },
      };
    });

    const result = await getProjectItems({ projectOwnerLogin: 'acme', projectNumber: 4 });
    expect(result.items).toEqual([{ id: 'PVTI_2', title: 'A draft idea', number: null, repo: null, fieldValues: [] }]);
  });
});
