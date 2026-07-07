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
  parseGdlcBoardSection,
  validateBoardConfig,
  readGdlcConfigBoardSection,
  readLegacyBoardConfig,
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

function tmpGdlcConfigWith(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-planning-gdlc-config-'));
  if (content !== null) {
    const gdlcDir = join(dir, 'gdlc');
    mkdirSync(gdlcDir, { recursive: true });
    writeFileSync(join(gdlcDir, 'config.yml'), content);
  }
  return dir;
}

/** A `readBoardConfig`/`loadGdlcConfig` **project root** carries its config
 * at `<root>/.config/gdlc/config.yml`, one level down from what
 * `tmpGdlcConfigWith` writes -- that helper is for the global root (or for
 * calling `readGdlcConfigBoardSection`/`resolveGdlcConfigPath` directly
 * with an already-resolved path), where $XDG_CONFIG_HOME already points at
 * a `.config`-equivalent directory. */
function tmpGdlcProjectWith(content: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'sdlc-planning-gdlc-project-'));
  if (content !== null) {
    const gdlcDir = join(dir, '.config', 'gdlc');
    mkdirSync(gdlcDir, { recursive: true });
    writeFileSync(join(gdlcDir, 'config.yml'), content);
  }
  return dir;
}

/** An empty, isolated global root -- ensures readBoardConfig's tests never
 * fall through to whatever the real machine's $XDG_CONFIG_HOME happens to
 * hold. */
function emptyGlobalRoot(): { XDG_CONFIG_HOME: string } {
  return { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'sdlc-planning-empty-global-')) };
}

const noWarn = () => {};

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

describe('parseGdlcBoardSection', () => {
  it('parses a top-level board: map with no frontmatter delimiters', () => {
    expect(parseGdlcBoardSection('board:\n  projectOwnerLogin: acme\n  projectNumber: 4\n')).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: '4',
    });
  });

  it('returns null when there is no board: key at all', () => {
    expect(parseGdlcBoardSection('targeting:\n  allowOrgs: [acme]\n')).toBeNull();
  });

  it('ignores other top-level sections around board:', () => {
    const text = 'targeting:\n  allowOrgs: [acme]\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 2\ndestination:\n  repo: acme/central\n';
    expect(parseGdlcBoardSection(text)).toEqual({ projectOwnerLogin: 'acme', projectNumber: '2' });
  });

  it('strips an inline comment from an unquoted value', () => {
    const text = 'board:\n  projectOwnerLogin: acme  # our org\n  projectNumber: 4\n';
    expect(parseGdlcBoardSection(text)).toEqual({ projectOwnerLogin: 'acme', projectNumber: '4' });
  });

  it('does not treat a # inside a quoted value as a comment', () => {
    const text = 'board:\n  projectOwnerLogin: "ac#me"\n  projectNumber: 4\n';
    expect(parseGdlcBoardSection(text)).toEqual({ projectOwnerLogin: 'ac#me', projectNumber: '4' });
  });

  it('strips a comment after a quoted value too', () => {
    const text = 'board:\n  projectOwnerLogin: "acme"  # our org\n  projectNumber: 4\n';
    expect(parseGdlcBoardSection(text)).toEqual({ projectOwnerLogin: 'acme', projectNumber: '4' });
  });
});

describe('validateBoardConfig', () => {
  it('passes null through', () => {
    expect(validateBoardConfig(null)).toBeNull();
  });

  it('rejects a missing projectOwnerLogin', () => {
    expect(validateBoardConfig({ projectNumber: '4' })).toBeNull();
  });

  it('rejects a non-positive-integer projectNumber', () => {
    expect(validateBoardConfig({ projectOwnerLogin: 'acme', projectNumber: 'nope' })).toBeNull();
  });

  it('rejects an unrecognized projectOwnerType', () => {
    expect(validateBoardConfig({ projectOwnerLogin: 'acme', projectNumber: '4', projectOwnerType: 'team' })).toBeNull();
  });

  it('defaults projectOwnerType to organization when absent', () => {
    expect(validateBoardConfig({ projectOwnerLogin: 'acme', projectNumber: '4' })).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      projectOwnerType: 'organization',
    });
  });
});

describe('readGdlcConfigBoardSection', () => {
  it('is null when the file is absent', () => {
    const dir = tmpGdlcConfigWith(null);
    expect(readGdlcConfigBoardSection(join(dir, 'gdlc', 'config.yml'))).toBeNull();
  });

  it('reads and validates a board section', () => {
    const dir = tmpGdlcConfigWith('board:\n  projectOwnerLogin: acme\n  projectNumber: 7\n  projectOwnerType: user\n');
    expect(readGdlcConfigBoardSection(join(dir, 'gdlc', 'config.yml'))).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 7,
      projectOwnerType: 'user',
    });
  });
});

describe('readLegacyBoardConfig', () => {
  it('is a silent no-op (null) when the settings file is absent', () => {
    expect(readLegacyBoardConfig(tmpProjectWith(null))).toBeNull();
  });

  it('is a silent no-op when the file has no board: map', () => {
    expect(readLegacyBoardConfig(tmpProjectWith('---\ntitle: x\n---\n'))).toBeNull();
  });

  it('reads a fully specified legacy board config', () => {
    const dir = tmpProjectWith('---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 7\n  projectOwnerType: user\n---\n');
    expect(readLegacyBoardConfig(dir)).toEqual({ projectOwnerLogin: 'acme', projectNumber: 7, projectOwnerType: 'user' });
  });
});

describe('readBoardConfig', () => {
  it('is a silent no-op (null) when no layer has a board config', () => {
    // An injected existsFn keeps the upward search hermetic -- a real climb
    // to the filesystem root risks a false match against whatever the
    // test-running machine's real ancestor directories happen to contain.
    expect(readBoardConfig(tmpProjectWith(null), emptyGlobalRoot(), noWarn, () => false)).toBeNull();
  });

  it('reads the project-level .config/gdlc/config.yml board section without warning', () => {
    const warn = vi.fn();
    const dir = tmpGdlcProjectWith('board:\n  projectOwnerLogin: acme\n  projectNumber: 4\n');
    expect(readBoardConfig(dir, emptyGlobalRoot(), warn)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      projectOwnerType: 'organization',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the global .config/gdlc/config.yml when the project layer has none', () => {
    const warn = vi.fn();
    const projectDir = tmpGdlcProjectWith(null);
    const globalDir = mkdtempSync(join(tmpdir(), 'sdlc-planning-global-'));
    mkdirSync(join(globalDir, 'gdlc'), { recursive: true });
    writeFileSync(join(globalDir, 'gdlc', 'config.yml'), 'board:\n  projectOwnerLogin: from-global\n  projectNumber: 9\n');

    expect(readBoardConfig(projectDir, { XDG_CONFIG_HOME: globalDir }, warn)).toEqual({
      projectOwnerLogin: 'from-global',
      projectNumber: 9,
      projectOwnerType: 'organization',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('prefers the project layer over the global layer when both are configured', () => {
    const projectDir = tmpGdlcProjectWith('board:\n  projectOwnerLogin: from-project\n  projectNumber: 1\n');
    const globalDir = mkdtempSync(join(tmpdir(), 'sdlc-planning-global-'));
    mkdirSync(join(globalDir, 'gdlc'), { recursive: true });
    writeFileSync(join(globalDir, 'gdlc', 'config.yml'), 'board:\n  projectOwnerLogin: from-global\n  projectNumber: 9\n');

    expect(readBoardConfig(projectDir, { XDG_CONFIG_HOME: globalDir }, noWarn)).toEqual({
      projectOwnerLogin: 'from-project',
      projectNumber: 1,
      projectOwnerType: 'organization',
    });
  });

  it('falls back to the legacy .claude/github-sdlc-planning.local.md board: key and warns once', () => {
    const warn = vi.fn();
    const dir = tmpProjectWith('---\nboard:\n  projectOwnerLogin: acme\n  projectNumber: 7\n  projectOwnerType: user\n---\n');
    expect(readBoardConfig(dir, emptyGlobalRoot(), warn)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 7,
      projectOwnerType: 'user',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Deprecation');
  });

  it('does not warn when nothing resolves at any layer', () => {
    const warn = vi.fn();
    expect(readBoardConfig(tmpProjectWith(null), emptyGlobalRoot(), warn, () => false)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('stops at an incomplete project board: section rather than falling through to a valid global one', () => {
    // The project layer's board: key is present (projectNumber only, no
    // login) -- matching config.ts's mergeConfigs semantics, a *present*
    // section wins wholly over the other layer, valid or not. Falling
    // through here would let this same pair of files resolve differently
    // depending on whether the hook or an mcp-server tool call read them.
    const projectDir = tmpGdlcProjectWith('board:\n  projectNumber: 4\n');
    const globalDir = mkdtempSync(join(tmpdir(), 'sdlc-planning-global-'));
    mkdirSync(join(globalDir, 'gdlc'), { recursive: true });
    writeFileSync(join(globalDir, 'gdlc', 'config.yml'), 'board:\n  projectOwnerLogin: from-global\n  projectNumber: 9\n');

    expect(readBoardConfig(projectDir, { XDG_CONFIG_HOME: globalDir }, noWarn)).toBeNull();
  });

  it('falls through to the global layer when the project file has no board: key at all (not merely invalid)', () => {
    const projectDir = tmpGdlcProjectWith('targeting:\n  allowOrgs: [acme]\n');
    const globalDir = mkdtempSync(join(tmpdir(), 'sdlc-planning-global-'));
    mkdirSync(join(globalDir, 'gdlc'), { recursive: true });
    writeFileSync(join(globalDir, 'gdlc', 'config.yml'), 'board:\n  projectOwnerLogin: from-global\n  projectNumber: 9\n');

    expect(readBoardConfig(projectDir, { XDG_CONFIG_HOME: globalDir }, noWarn)).toEqual({
      projectOwnerLogin: 'from-global',
      projectNumber: 9,
      projectOwnerType: 'organization',
    });
  });

  it('issue #106: finds the project layer when cwd is nested two directories below the project root', () => {
    const projectDir = tmpGdlcProjectWith('board:\n  projectOwnerLogin: acme\n  projectNumber: 4\n');
    const nestedCwd = join(projectDir, 'plugins', 'some-plugin');
    mkdirSync(nestedCwd, { recursive: true });

    expect(readBoardConfig(nestedCwd, emptyGlobalRoot(), noWarn)).toEqual({
      projectOwnerLogin: 'acme',
      projectNumber: 4,
      projectOwnerType: 'organization',
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
