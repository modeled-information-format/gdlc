import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// Same rationale as diagnostic-capture.test.ts (github-bug-capture): the
// in-progress hook's logic is a dependency-free hooks utility, tested here
// through the plugin's single vitest rig, but intentionally outside src/
// (and outside the coverage include) because the hook runs it with bare
// node, not through the bundled server.
import {
  parseBoardConfig,
  readBoardConfig,
  extractAffectedIssue,
  isEligibleStatus,
  extractProjectId,
  extractItemAndStatus,
  extractStatusFieldAndOption,
  setIssueInProgress,
  buildAdditionalContext,
} from '../../../hooks/lib/in-progress.mjs';

function tmpProjectWith(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-planning-board-settings-'));
  if (content !== null) {
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'github-sdlc-planning.local.md'), content);
  }
  return dir;
}

describe('parseBoardConfig', () => {
  it('parses a board map from frontmatter', () => {
    const text = '---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 4\n  projectOwnerType: organization\n---\nNotes.\n';
    expect(parseBoardConfig(text)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: '4',
      projectOwnerType: 'organization',
    });
  });

  it('returns null for non-frontmatter text', () => {
    expect(parseBoardConfig('# just a heading\n')).toBeNull();
  });

  it('returns an empty object when there is no board: map', () => {
    expect(parseBoardConfig('---\ntitle: x\n---\n')).toEqual({});
  });

  it('skips a malformed indented entry and stops the map at the first non-indented line', () => {
    const text = '---\nboard:\n  not a valid line\n  projectOwnerLogin: acme\nother: 1\n---\n';
    expect(parseBoardConfig(text)).toEqual({ projectOwnerLogin: 'acme' });
  });
});

describe('readBoardConfig', () => {
  it('is a silent no-op (null) when the settings file is absent', () => {
    const dir = tmpProjectWith(null);
    expect(readBoardConfig(dir)).toBeNull();
  });

  it('is a silent no-op when the file has no board: map', () => {
    const dir = tmpProjectWith('---\ntitle: x\n---\n');
    expect(readBoardConfig(dir)).toBeNull();
  });

  it('is a silent no-op when projectOwnerLogin is missing', () => {
    const dir = tmpProjectWith('---\nboard:\n  projectNumber: 4\n---\n');
    expect(readBoardConfig(dir)).toBeNull();
  });

  it('is a silent no-op when projectNumber is not a positive integer', () => {
    const dir = tmpProjectWith('---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: not-a-number\n---\n');
    expect(readBoardConfig(dir)).toBeNull();
  });

  it('is a silent no-op when projectOwnerType is an unrecognized value', () => {
    const dir = tmpProjectWith(
      '---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 4\n  projectOwnerType: team\n---\n',
    );
    expect(readBoardConfig(dir)).toBeNull();
  });

  it('defaults projectOwnerType to organization when absent', () => {
    const dir = tmpProjectWith('---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 4\n---\n');
    expect(readBoardConfig(dir)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      projectOwnerType: 'organization',
    });
  });

  it('reads a fully specified board config', () => {
    const dir = tmpProjectWith(
      '---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 7\n  projectOwnerType: user\n---\n',
    );
    expect(readBoardConfig(dir)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 7,
      projectOwnerType: 'user',
    });
  });
});

describe('extractAffectedIssue', () => {
  it('extracts the child issue from add_sub_issue (the work item being started)', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__add_sub_issue',
      tool_input: { owner: 'acme', repo: 'widgets', parentNumber: 1, childNumber: 9 },
    };
    expect(extractAffectedIssue(input)).toEqual({ owner: 'acme', repo: 'widgets', number: 9 });
  });

  it('prefers childOwner/childRepo over owner/repo for a cross-repo sub-issue', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__add_sub_issue',
      tool_input: {
        owner: 'acme',
        repo: 'parent-repo',
        parentNumber: 1,
        childNumber: 9,
        childOwner: 'acme',
        childRepo: 'child-repo',
      },
    };
    expect(extractAffectedIssue(input)).toEqual({ owner: 'acme', repo: 'child-repo', number: 9 });
  });

  it('extracts the updated issue from update_issue', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__update_issue',
      tool_input: { owner: 'acme', repo: 'widgets', number: 9, title: 'New title' },
    };
    expect(extractAffectedIssue(input)).toEqual({ owner: 'acme', repo: 'widgets', number: 9 });
  });

  it('skips update_issue when the update closes the issue (a completion signal, not a start signal)', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__update_issue',
      tool_input: { owner: 'acme', repo: 'widgets', number: 9, state: 'closed' },
    };
    expect(extractAffectedIssue(input)).toBeNull();
  });

  it('is null for an irrelevant tool_name', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__create_issue',
      tool_input: { owner: 'acme', repo: 'widgets', number: 9 },
    };
    expect(extractAffectedIssue(input)).toBeNull();
  });

  it('is null for malformed/missing tool_input', () => {
    expect(extractAffectedIssue({ tool_name: 'mcp__github-sdlc-planning__update_issue', tool_input: null })).toBeNull();
    expect(extractAffectedIssue({ tool_name: 'mcp__github-sdlc-planning__update_issue' })).toBeNull();
    expect(extractAffectedIssue({})).toBeNull();
  });

  it('is null when required fields are missing or the wrong type', () => {
    const input = {
      tool_name: 'mcp__github-sdlc-planning__update_issue',
      tool_input: { owner: 'acme', number: 'nine' },
    };
    expect(extractAffectedIssue(input)).toBeNull();
  });
});

describe('isEligibleStatus', () => {
  it('is eligible when unset', () => {
    expect(isEligibleStatus(null)).toBe(true);
    expect(isEligibleStatus(undefined)).toBe(true);
  });

  it('is eligible when Todo', () => {
    expect(isEligibleStatus('Todo')).toBe(true);
  });

  it('is not eligible when already In Progress', () => {
    expect(isEligibleStatus('In Progress')).toBe(false);
  });

  it('is not eligible when Done', () => {
    expect(isEligibleStatus('Done')).toBe(false);
  });

  it('is not eligible for any other status value', () => {
    expect(isEligibleStatus('Blocked')).toBe(false);
  });
});

describe('extractProjectId', () => {
  it('reads organization.projectV2.id for the organization owner type', () => {
    expect(extractProjectId({ organization: { projectV2: { id: 'PVT_1' } } }, 'organization')).toBe('PVT_1');
  });

  it('reads user.projectV2.id for the user owner type', () => {
    expect(extractProjectId({ user: { projectV2: { id: 'PVT_2' } } }, 'user')).toBe('PVT_2');
  });

  it('is null when the project is not found', () => {
    expect(extractProjectId({ organization: { projectV2: null } }, 'organization')).toBeNull();
    expect(extractProjectId({}, 'organization')).toBeNull();
  });
});

describe('extractItemAndStatus', () => {
  it('finds the item matching the target project and its Status option name', () => {
    const data = {
      repository: {
        issue: {
          projectItems: {
            nodes: [
              { id: 'PVTI_other', project: { id: 'PVT_other' }, fieldValues: { nodes: [] } },
              {
                id: 'PVTI_1',
                project: { id: 'PVT_1' },
                fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] },
              },
            ],
          },
        },
      },
    };
    expect(extractItemAndStatus(data, 'PVT_1')).toEqual({ itemId: 'PVTI_1', status: 'Todo' });
  });

  it('reports a null status when the item has no Status field value yet', () => {
    const data = {
      repository: {
        issue: { projectItems: { nodes: [{ id: 'PVTI_1', project: { id: 'PVT_1' }, fieldValues: { nodes: [] } }] } },
      },
    };
    expect(extractItemAndStatus(data, 'PVT_1')).toEqual({ itemId: 'PVTI_1', status: null });
  });

  it('is null when the issue has no item on this project', () => {
    const data = { repository: { issue: { projectItems: { nodes: [] } } } };
    expect(extractItemAndStatus(data, 'PVT_1')).toBeNull();
  });

  it('is null when the issue itself is missing from the response', () => {
    expect(extractItemAndStatus({ repository: { issue: null } }, 'PVT_1')).toBeNull();
    expect(extractItemAndStatus({}, 'PVT_1')).toBeNull();
  });
});

describe('extractStatusFieldAndOption', () => {
  it('finds the Status field id and the In Progress option id', () => {
    const data = {
      node: {
        fields: {
          nodes: [
            { __typename: 'ProjectV2FieldCommon', id: 'PVTF_title', name: 'Title' },
            {
              __typename: 'ProjectV2SingleSelectField',
              id: 'PVTF_status',
              name: 'Status',
              options: [
                { id: 'OPT_todo', name: 'Todo' },
                { id: 'OPT_inprogress', name: 'In Progress' },
                { id: 'OPT_done', name: 'Done' },
              ],
            },
          ],
        },
      },
    };
    expect(extractStatusFieldAndOption(data)).toEqual({ fieldId: 'PVTF_status', optionId: 'OPT_inprogress' });
  });

  it('is null when there is no Status single-select field', () => {
    const data = { node: { fields: { nodes: [{ __typename: 'ProjectV2FieldCommon', id: 'PVTF_title', name: 'Title' }] } } };
    expect(extractStatusFieldAndOption(data)).toBeNull();
  });

  it('is null when Status has no In Progress option', () => {
    const data = {
      node: {
        fields: {
          nodes: [
            {
              __typename: 'ProjectV2SingleSelectField',
              id: 'PVTF_status',
              name: 'Status',
              options: [{ id: 'OPT_todo', name: 'Todo' }],
            },
          ],
        },
      },
    };
    expect(extractStatusFieldAndOption(data)).toBeNull();
  });
});

describe('setIssueInProgress', () => {
  const affected = { owner: 'acme', repo: 'widgets', number: 9 };
  const config = { projectOwnerLogin: 'acme', projectNumber: 4, projectOwnerType: 'organization' };

  function fieldsResponse() {
    return {
      node: {
        fields: {
          nodes: [
            {
              __typename: 'ProjectV2SingleSelectField',
              id: 'PVTF_status',
              name: 'Status',
              options: [
                { id: 'OPT_todo', name: 'Todo' },
                { id: 'OPT_inprogress', name: 'In Progress' },
              ],
            },
          ],
        },
      },
    };
  }

  it('sets Status to In Progress when the item is Todo', async () => {
    const runGraphQL = vi.fn(async (query: string) => {
      if (query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (query.includes('projectItems')) {
        return {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  { id: 'PVTI_1', project: { id: 'PVT_1' }, fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] } },
                ],
              },
            },
          },
        };
      }
      if (query.includes('fields(first')) return fieldsResponse();
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } };
    });

    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: true });
    expect(runGraphQL).toHaveBeenCalledTimes(4);
    const mutationCall = runGraphQL.mock.calls.find(([q]) => q.includes('updateProjectV2ItemFieldValue'));
    expect(mutationCall?.[1]).toEqual({ projectId: 'PVT_1', itemId: 'PVTI_1', fieldId: 'PVTF_status', optionId: 'OPT_inprogress' });
  });

  it('sets Status to In Progress when the item has no Status value yet', async () => {
    const runGraphQL = vi.fn(async (query: string) => {
      if (query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (query.includes('projectItems')) {
        return { repository: { issue: { projectItems: { nodes: [{ id: 'PVTI_1', project: { id: 'PVT_1' }, fieldValues: { nodes: [] } }] } } } };
      }
      if (query.includes('fields(first')) return fieldsResponse();
      return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'PVTI_1' } } };
    });

    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: true });
  });

  it('does not mutate when the item is already In Progress', async () => {
    const runGraphQL = vi.fn(async (query: string) => {
      if (query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (query.includes('projectItems')) {
        return {
          repository: {
            issue: {
              projectItems: {
                nodes: [
                  { id: 'PVTI_1', project: { id: 'PVT_1' }, fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] } },
                ],
              },
            },
          },
        };
      }
      throw new Error('should not reach the fields/mutation query');
    });

    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: false, reason: 'not_eligible' });
  });

  it('does not mutate when the item is already Done', async () => {
    const runGraphQL = vi.fn(async (query: string) => {
      if (query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (query.includes('projectItems')) {
        return {
          repository: {
            issue: {
              projectItems: {
                nodes: [{ id: 'PVTI_1', project: { id: 'PVT_1' }, fieldValues: { nodes: [{ name: 'Done', field: { name: 'Status' } }] } }],
              },
            },
          },
        };
      }
      throw new Error('should not reach the fields/mutation query');
    });

    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: false, reason: 'not_eligible' });
  });

  it('is a no-op when the issue is not on the board at all', async () => {
    const runGraphQL = vi.fn(async (query: string) => {
      if (query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      if (query.includes('projectItems')) return { repository: { issue: { projectItems: { nodes: [] } } } };
      throw new Error('should not reach the fields/mutation query');
    });

    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: false, reason: 'not_on_board' });
  });

  it('is a no-op when the configured project cannot be resolved', async () => {
    const runGraphQL = vi.fn(async () => ({ organization: { projectV2: null } }));
    const result = await setIssueInProgress(affected, config, runGraphQL);
    expect(result).toEqual({ changed: false, reason: 'project_not_found' });
  });
});

describe('buildAdditionalContext', () => {
  it('names the issue and the transition', () => {
    const text = buildAdditionalContext({ owner: 'acme', repo: 'widgets', number: 9 });
    expect(text).toContain('acme/widgets#9');
    expect(text).toContain('In Progress');
  });
});
