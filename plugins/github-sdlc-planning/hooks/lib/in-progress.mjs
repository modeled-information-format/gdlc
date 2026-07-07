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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';

const SETTINGS_RELPATH = join('.claude', 'github-sdlc-planning.local.md');
const GDLC_CONFIG_RELPATH = join('gdlc', 'config.yml');

/** Same relative suffix as the mcp-server's config.ts (issue #82) -- this
 * hook can't import that module (dependency-free by design, no
 * node_modules at hook-execution time), so it re-implements just enough
 * of the resolution rule and the `board:` section shape to migrate off
 * the legacy carrier below. */
function resolveGdlcConfigPath(root) {
  return join(root, GDLC_CONFIG_RELPATH);
}

function resolveGlobalGdlcConfigRoot(env = process.env) {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}

/** Issue #106 / ADR-0005: same upward search as the mcp-server's
 * config.ts#findProjectConfigRoot, re-implemented here for the same
 * dependency-free reason as the rest of this module. Climbs from `startDir`
 * toward the filesystem root looking for `<dir>/.config/gdlc/config.yml`;
 * fixes a cwd nested inside the project root, does NOT fix a cwd that is an
 * ancestor of the project root (a multi-repo workspace directory above
 * several sibling repos) -- see that function's doc comment and ADR-0005
 * for the full reasoning. `ceiling` (default `homedir()`) stops the climb
 * before checking that directory at all -- impartial-review finding: the
 * home directory is never a legitimate project root, and left unguarded the
 * climb would eventually check `homedir()/.config/gdlc/config.yml`, the
 * OS-default global-layer path, letting a stray leftover file there
 * silently outrank the real configured global config (see
 * config.ts#findProjectConfigRoot for the full reasoning). Returns `null` if
 * nothing is found by the time the ceiling or the filesystem root is
 * reached. */
function findGdlcProjectRoot(startDir, existsFn = existsSync, ceiling = homedir()) {
  const ceilingResolved = resolvePath(ceiling);
  let dir = resolvePath(startDir);
  for (;;) {
    if (dir === ceilingResolved) return null;
    if (existsFn(resolveGdlcConfigPath(join(dir, '.config')))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Same collision guard as the mcp-server's config.ts#resolveProjectConfigPath
 * (impartial-review finding): `resolveGlobalGdlcConfigRoot`'s default
 * (`homedir()/.config`) is a directory the upward search legitimately
 * passes through for any cwd under `$HOME`, so an unguarded search could
 * "find" the global layer's own file and let it silently outrank the real
 * global config (e.g. a customized `XDG_CONFIG_HOME` plus a stray leftover
 * `~/.config/gdlc/config.yml`), since a *present* project section always
 * wins over the global one below. Excluding an exact path match closes
 * this for both the default and customized cases. */
function resolveGdlcProjectConfigPath(startDir, existsFn, env) {
  const root = findGdlcProjectRoot(startDir, existsFn);
  if (root === null) return null;
  const path = resolveGdlcConfigPath(join(root, '.config'));
  return path === resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)) ? null : path;
}

/** Extract a scalar value from the text captured after `key:`, matching
 * how a real YAML parser would treat it: a quoted value stops at its
 * closing quote (anything after, including a `#...` comment, is not part
 * of the value); an unquoted value stops at an inline ` #...` comment.
 * Without this, an inline comment on a `board:` line (e.g.
 * `projectOwnerLogin: acme  # our org`) would be captured as part of the
 * value and passed to GitHub verbatim, silently failing to resolve. */
function extractScalarValue(raw) {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = trimmed.indexOf(quote, 1);
    return closingIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, closingIndex);
  }
  const commentIndex = trimmed.search(/\s#/);
  return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
}

/** Parse a top-level `board:` map out of a plain-YAML gdlc/config.yml
 * document (no frontmatter delimiters, unlike the legacy carrier below).
 * Same constrained 2-space-indent scalar-map parsing as `parseBoardConfig`,
 * minus the `---` requirement. Returns a plain string-keyed map, or `null`
 * if the file has no `board:` key at all -- callers use that `null` to
 * decide whether to fall through to the next config layer, distinct from
 * a `board:` key that is present but incomplete/invalid (see
 * `readBoardConfig`). Exported for tests. */
export function parseGdlcBoardSection(text) {
  const lines = String(text).split(/\r?\n/);
  let inBoard = false;
  let found = false;
  const board = {};
  for (const line of lines) {
    if (/^board:\s*$/.test(line)) {
      inBoard = true;
      found = true;
      continue;
    }
    if (inBoard) {
      const m = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*(.+?)\s*$/.exec(line);
      if (m) {
        board[m[1]] = extractScalarValue(m[2]);
        continue;
      }
      if (/^ {2}\S/.test(line)) continue;
      inBoard = false;
    }
  }
  return found ? board : null;
}

/** Validate a raw string-keyed board map the same way `readBoardConfig`
 * validates the legacy carrier: missing/empty `projectOwnerLogin`, a
 * non-positive-integer `projectNumber`, or an unrecognized
 * `projectOwnerType` all mean "not configured" (`null`). Exported for
 * tests. */
export function validateBoardConfig(board) {
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

/** Read one layer's gdlc/config.yml, distinguishing "no `board:` key at
 * all" (`present: false` -- `readBoardConfig` should try the next layer)
 * from "a `board:` key exists but is incomplete/invalid" (`present: true`,
 * `board: null` -- `readBoardConfig` must stop here, matching the
 * mcp-server's `config.ts`: a defined-but-incomplete section replaces the
 * other layer wholly, it does not fall through to it). */
function resolveGdlcLayerBoard(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: false, board: null };
  }
  const raw = parseGdlcBoardSection(text);
  if (raw === null) return { present: false, board: null };
  return { present: true, board: validateBoardConfig(raw) };
}

/** Read one layer's gdlc/config.yml and return its validated `board:`
 * section, or `null` if the file is missing, has no board section, or the
 * section fails validation. Exported for tests; `readBoardConfig` uses
 * `resolveGdlcLayerBoard` directly instead, since it also needs to know
 * whether the `board:` key was present at all (see that function). */
export function readGdlcConfigBoardSection(path) {
  return resolveGdlcLayerBoard(path).board;
}

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

/** Read the legacy `.claude/github-sdlc-planning.local.md` `board:`
 * frontmatter key. Exported for tests; superseded by
 * `.config/gdlc/config.yml` (ADR-0004) -- see `readBoardConfig`.
 *
 * Deliberately NOT covered by #106/ADR-0005's upward search (impartial-review
 * finding): this carrier is a different file (`.claude/*.local.md`, not
 * `.config/gdlc/config.yml`) that would need its own independent climb to
 * benefit the same way, and it is already scheduled for removal "for one
 * release" per the deprecation notice below -- not worth the added search
 * machinery for a carrier on its way out. A repo still on this carrier gets
 * the pre-#106 cwd-exact behavior; migrating to `.config/gdlc/config.yml`
 * gets the upward-search improvement for free. */
export function readLegacyBoardConfig(cwd = process.cwd()) {
  let text;
  try {
    text = readFileSync(join(cwd, SETTINGS_RELPATH), 'utf8');
  } catch {
    return null;
  }
  return validateBoardConfig(parseBoardConfig(text));
}

/** Fail-closed by design: no configured layer, a missing `board:` map, or
 * a malformed `projectNumber`/`projectOwnerType` at every layer all mean
 * "not configured" (`null`) rather than a thrown error. A hook must never
 * break the tool call it observes.
 *
 * Resolution order (ADR-0004's migration plan, issue #83): the project
 * layer's `.config/gdlc/config.yml` `board:` section -- searched upward
 * from `cwd` toward the filesystem root (issue #106 / ADR-0005), not just
 * at the literal `cwd` -- then the global layer's
 * `$XDG_CONFIG_HOME/gdlc/config.yml` `board:` section, then -- for one
 * release -- the legacy `.claude/github-sdlc-planning.local.md` `board:`
 * key, emitting one deprecation notice via `warn` when that legacy
 * fallback is what resolved it.
 *
 * A layer whose `board:` key is present but incomplete/invalid stops the
 * cascade there (returning `null`) rather than falling through to the
 * next layer -- matching the mcp-server's `config.ts`, where a project
 * section replaces the global one wholly once it's defined at all, valid
 * or not. Falling through on partial-but-present data would let the same
 * config file resolve to different board coordinates depending on whether
 * this hook or an mcp-server tool call read it. */
export function readBoardConfig(
  cwd = process.cwd(),
  env = process.env,
  warn = (msg) => process.stderr.write(`${msg}\n`),
  existsFn = existsSync,
) {
  const projectPath = resolveGdlcProjectConfigPath(cwd, existsFn, env);
  const project = projectPath === null ? { present: false, board: null } : resolveGdlcLayerBoard(projectPath);
  if (project.present) return project.board;

  const global = resolveGdlcLayerBoard(resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)));
  if (global.present) return global.board;

  const fromLegacy = readLegacyBoardConfig(cwd);
  if (fromLegacy !== null) {
    warn(
      'Deprecation: board: in .claude/github-sdlc-planning.local.md is superseded by ' +
        'the board: section of .config/gdlc/config.yml (ADR-0004). Migrate when convenient.',
    );
  }
  return fromLegacy;
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
