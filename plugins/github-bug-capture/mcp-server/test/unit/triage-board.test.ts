import { describe, it, expect } from 'vitest';
import { mockGraphQL, type GraphQLRequestBody } from '../helpers.js';
import { ensureSeverityField, setSeverity, SEVERITY_LEVELS } from '../../src/tools/triage-board.js';

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

  it('resolves the board item through the issue projectItems connection and sets the option', async () => {
    let updateVars: Record<string, unknown> | undefined;
    mockBoard({
      projectItems: [
        { id: 'PVTI_other', project: { id: 'PVT_other' } },
        { id: 'PVTI_9', project: { id: 'PVT_1' } },
      ],
      onUpdate: (vars) => {
        updateVars = vars;
      },
    });

    const result = await setSeverity(INPUT);

    expect(result).toEqual({ itemId: 'PVTI_9', fieldId: 'F_sev', optionId: 'OPT_high', severity: 'High' });
    expect(updateVars).toEqual({ projectId: 'PVT_1', itemId: 'PVTI_9', fieldId: 'F_sev', optionId: 'OPT_high' });
  });

  it('fails with resolve_issue_id when the issue does not exist', async () => {
    mockBoard({ issue: null });
    await expect(setSeverity(INPUT)).rejects.toMatchObject({ code: 'resolve_issue_id' });
  });

  it('fails with issue_not_on_board when the issue has no item on this project', async () => {
    mockBoard({ projectItems: [{ id: 'PVTI_other', project: { id: 'PVT_other' } }] });
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
});
