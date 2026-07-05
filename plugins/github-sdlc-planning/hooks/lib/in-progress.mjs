/**
 * In-progress hook: the testable core of ADR-0003's second decision item
 * (docs/decisions/adr-0003-board-status-hygiene.md).
 *
 * Native Projects v2 workflows already cover Todo-on-add and Done-on-close/
 * merge; the one gap they leave is "work has begun, no PR yet", and this
 * hook closes it. Config parsing, stdin/tool-input extraction, and the
 * eligibility decision are all dependency-free pure functions here, same
 * spirit as hooks/lib/settings.mjs (github-bug-capture) and
 * hooks/lib/diagnostic-capture.mjs. The GraphQL round trips are orchestrated
 * here too, but every one of them goes through a caller-supplied
 * `runGraphQL` function, the only piece that ever shells out to `gh`, so
 * this module never touches child_process and tests never shell out.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SETTINGS_RELPATH = join('.claude', 'github-sdlc-planning.local.md');

/** Parse the `board:` map out of the settings-file frontmatter. Returns a
 * plain string-keyed map (values as raw strings) or `null` if the file isn't
 * frontmatter-shaped at all. Exported for tests. */
export function parseBoardConfig(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0] !== '---') return null;
  let inBoard = false;
  const board = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') break;
    if (/^board:\s*$/.test(line)) {
      inBoard = true;
      continue;
    }
    if (inBoard) {
      const m = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*(.+?)\s*$/.exec(line);
      if (m) {
        board[m[1]] = m[2].replace(/^["']|["']$/g, '');
        continue;
      }
      // A malformed indented entry is skipped; the first non-indented line
      // ends the map, same convention as github-bug-capture's pack-toggles.
      if (/^ {2}\S/.test(line)) continue;
      inBoard = false;
    }
  }
  return board;
}

/** Fail-closed by design: missing file, missing `board:` map, missing
 * required keys, or a malformed `projectNumber`/`projectOwnerType` all mean
 * "not configured" (`null`) rather than a thrown error. A hook must never
 * break the tool call it observes. */
export function readBoardConfig(cwd = process.cwd()) {
  let text;
  try {
    text = readFileSync(join(cwd, SETTINGS_RELPATH), 'utf8');
  } catch {
    return null;
  }
  const board = parseBoardConfig(text);
  if (board === null) return null;

  const { projectOwnerLogin, projectNumber, projectOwnerType } = board;
  if (typeof projectOwnerLogin !== 'string' || projectOwnerLogin === '') return null;

  const parsedNumber = Number(projectNumber);
  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) return null;

  if (projectOwnerType !== undefined && projectOwnerType !== 'organization' && projectOwnerType !== 'user') {
    return null;
  }

  return {
    projectOwnerLogin,
    projectNumber: parsedNumber,
    projectOwnerType: projectOwnerType ?? 'organization',
  };
}

const RELEVANT_TOOLS = new Set([
  'mcp__github-sdlc-planning__add_sub_issue',
  'mcp__github-sdlc-planning__update_issue',
]);

/** Determine the issue that just had work started against it, from the hook
 * stdin payload's `tool_name`/`tool_input`. For `add_sub_issue`, the child is
 * the work item being started (the parent already existed). For
 * `update_issue`, the updated issue itself, unless the update closed it,
 * which is a completion signal, not a start-of-work signal, and is left to
 * the native `Item closed` workflow. Returns `null` for anything else,
 * including malformed input. */
export function extractAffectedIssue(input) {
  const toolName = input?.tool_name;
  if (!RELEVANT_TOOLS.has(toolName)) return null;

  const toolInput = input?.tool_input;
  if (toolInput === null || typeof toolInput !== 'object') return null;

  if (toolName === 'mcp__github-sdlc-planning__add_sub_issue') {
    const owner = toolInput.childOwner ?? toolInput.owner;
    const repo = toolInput.childRepo ?? toolInput.repo;
    const number = toolInput.childNumber;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof number !== 'number') return null;
    return { owner, repo, number };
  }

  // mcp__github-sdlc-planning__update_issue
  if (toolInput.state === 'closed') return null;
  const { owner, repo, number } = toolInput;
  if (typeof owner !== 'string' || typeof repo !== 'string' || typeof number !== 'number') return null;
  return { owner, repo, number };
}

/** Eligible only when the board item has no Status yet or is still `Todo`.
 * `In Progress`, `Done`, or any other value is left alone. */
export function isEligibleStatus(status) {
  return status === null || status === undefined || status === 'Todo';
}

export const ORG_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    organization(login: $login) { projectV2(number: $number) { id } }
  }
`;

export const USER_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    user(login: $login) { projectV2(number: $number) { id } }
  }
`;

export function extractProjectId(data, ownerType) {
  if (ownerType === 'user') return data?.user?.projectV2?.id ?? null;
  return data?.organization?.projectV2?.id ?? null;
}

export const ISSUE_PROJECT_ITEM_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 100) {
          nodes {
            id
            project { id }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
      }
    }
  }
`;

/** Find the item this issue holds on the target project (matched by node ID,
 * never by position) and its current Status option name, if any. Returns
 * `null` when the issue is not on this project at all. */
export function extractItemAndStatus(data, projectId) {
  const nodes = data?.repository?.issue?.projectItems?.nodes ?? [];
  const item = nodes.find((n) => n.project?.id === projectId);
  if (!item) return null;
  const statusValue = (item.fieldValues?.nodes ?? []).find((fv) => fv.field?.name === 'Status');
  return { itemId: item.id, status: statusValue?.name ?? null };
}

export const PROJECT_FIELDS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } }
          }
        }
      }
    }
  }
`;

/** Resolve the `Status` field's node ID and its `In Progress` option's node
 * ID, both required by `updateProjectV2ItemFieldValue`, neither guessable
 * from the option name alone. Returns `null` if this project has no `Status`
 * single-select field or no `In Progress` option (an unconfigured or
 * differently-shaped board). */
export function extractStatusFieldAndOption(data, statusFieldName = 'Status', optionName = 'In Progress') {
  const nodes = data?.node?.fields?.nodes ?? [];
  const field = nodes.find((n) => n.name === statusFieldName && Array.isArray(n.options));
  if (!field) return null;
  const option = field.options.find((o) => o.name === optionName);
  if (!option) return null;
  return { fieldId: field.id, optionId: option.id };
}

export const UPDATE_FIELD_VALUE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
    ) {
      projectV2Item { id }
    }
  }
`;

/** Orchestrates the full read-then-maybe-write flow against a single
 * project: resolve the project, find the issue's item and current Status,
 * skip if ineligible or not on the board, resolve the `In Progress` option,
 * then mutate. `runGraphQL(query, variables)` is the one thing that ever
 * talks to GitHub: callers inject a `gh api graphql` wrapper in production
 * and a canned resolver in tests. Never throws for an unconfigured/
 * unreachable board; the caller's try/catch (or a rejected runGraphQL) is
 * expected to fail closed to a no-op. */
export async function setIssueInProgress(affected, config, runGraphQL) {
  const ownerType = config.projectOwnerType ?? 'organization';
  const projectQuery = ownerType === 'user' ? USER_PROJECT_ID_QUERY : ORG_PROJECT_ID_QUERY;

  const projectData = await runGraphQL(projectQuery, {
    login: config.projectOwnerLogin,
    number: config.projectNumber,
  });
  const projectId = extractProjectId(projectData, ownerType);
  if (!projectId) return { changed: false, reason: 'project_not_found' };

  const itemData = await runGraphQL(ISSUE_PROJECT_ITEM_QUERY, {
    owner: affected.owner,
    repo: affected.repo,
    number: affected.number,
  });
  const item = extractItemAndStatus(itemData, projectId);
  if (!item) return { changed: false, reason: 'not_on_board' };
  if (!isEligibleStatus(item.status)) return { changed: false, reason: 'not_eligible' };

  const fieldsData = await runGraphQL(PROJECT_FIELDS_QUERY, { projectId });
  const target = extractStatusFieldAndOption(fieldsData);
  if (!target) return { changed: false, reason: 'status_field_not_found' };

  await runGraphQL(UPDATE_FIELD_VALUE_MUTATION, {
    projectId,
    itemId: item.itemId,
    fieldId: target.fieldId,
    optionId: target.optionId,
  });
  return { changed: true };
}

export function buildAdditionalContext(affected) {
  return `${affected.owner}/${affected.repo}#${affected.number} moved to In Progress on the project board.`;
}
