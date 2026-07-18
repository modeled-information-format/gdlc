/**
 * Ticket-hygiene reinforcement hook: the testable core (ADR-0007,
 * docs/decisions/adr-0007-ticket-hygiene-reinforcement-hooks.md).
 *
 * Canonical source of truth: plugins/github-sdlc-planning/hooks/lib/hygiene-check.mjs.
 * github-pull-requests and github-bug-capture each ship a byte-identical
 * copy of this file and its two callers (../hygiene-check.mjs,
 * ../hygiene-aggregate.mjs) at the same relative path under their own
 * hooks/ -- including this copy, if you're reading it from one of those
 * plugins right now. A build-time drift check
 * (.github/workflows/ci.yml's hygiene-hook-drift-check job) fails a PR if
 * any copy diverges from the canonical source above. Dependency-free by
 * design (no node_modules at
 * hook-execution time), same spirit as hooks/lib/in-progress.mjs and
 * github-bug-capture's hooks/lib/diagnostic-capture.mjs.
 *
 * Non-negotiable contract (this hook's entire NFR set): every check here
 * either resolves to a finding, resolves to "no gap", or fails open silently
 * -- it never guesses, never blocks, and the caller (../hygiene-check.mjs)
 * never emits `decision: "block"` or a non-zero exit under any circumstance.
 * This module never shells out itself: every GraphQL round trip goes through
 * a caller-supplied `runGraphQL(query, variables)`, exactly the same
 * dependency-injection shape as in-progress.mjs, so tests never touch
 * `child_process` or the network.
 *
 * Scope note (reconciled against ADR-0003): native Projects v2 workflows
 * already own Todo-on-add and Done-on-close/merge, and in-progress.mjs
 * already closes the In-Progress gap. The status-progression check below
 * is deliberately narrower than "any drift" -- it only ever recommends
 * In Review, and only when a PR was just opened closing the issue. It never
 * recommends Todo, In Progress, or Done; recommending any of those would
 * re-introduce the exact duplicated-automation risk ADR-0003 killed.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Touch extraction: normalize the three tool-agnostic surfaces (a plugin's
// own MCP tools, the generic `github` MCP server, and raw `gh` CLI calls)
// into one shape so every check below is surface-agnostic.
// ---------------------------------------------------------------------------

/** Every MCP tool name in this family (whichever plugin hosts the copy, or
 * the generic `github` server) ends in `__<action>`; the action name alone
 * is what the checks below care about. Returns `null` for a non-MCP tool
 * name (e.g. `Bash`). */
function mcpAction(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null;
  const idx = toolName.lastIndexOf('__');
  if (idx <= 4) return null;
  return toolName.slice(idx + 2);
}

const PR_CREATE_ACTIONS = new Set(['create_pull_request']);
const ISSUE_CREATE_ACTIONS = new Set(['create_issue']);
// 'set_field_value' names the tool this check most wants to police (a
// direct Status-field change), but that tool's own input/output only ever
// carries `itemId`/`fieldId`, never `owner`/`repo`/`number` -- a Projects
// v2 item is addressed by itemId, not issue coordinates (issue #172).
// extractTouch stays synchronous and carries the bare `itemId` through
// instead (see its own doc comment); checkLifecycleComment resolves it to
// owner/repo/number via `resolveItemIdentity` (an async GraphQL round
// trip) before running its scan, failing open on any resolution error the
// same way every other check does.
const STATUS_MUTATE_ACTIONS = new Set(['set_field_value', 'update_issue']);
// The generic github MCP server's own comment tool -- NOT issue_write,
// which is a create/update tool (method: 'create'|'update') with no
// comment-posting semantics at all; see normalizeMcpAction below for how
// issue_write is folded into ISSUE_CREATE_ACTIONS/STATUS_MUTATE_ACTIONS
// instead of miscategorized here.
const COMMENT_ACTIONS = new Set(['add_issue_comment']);
// gdlc#201/#210: the generic github MCP server's merge tool (no
// plugin-scoped merge_pull_request tool exists in this marketplace as of
// this writing -- merging goes through mcp__github__merge_pull_request or
// `gh pr merge`, per this workspace's own CLAUDE.local.md). A merge is the
// one moment a PR's closing-keyword references become load-bearing --
// checkPostMergeClosingKeywords below is the only check that fires on it.
const PR_MERGE_ACTIONS = new Set(['merge_pull_request']);
// gdlc#203/#212: three actions matched by this hook's own broad
// registration regex (^mcp__...__.*) but previously absent from every
// action set above, so extractTouch returned null for them and the hook
// silently no-op'd. `add_sub_issue`'s target is the PARENT issue (its
// `parentNumber`, not `childNumber`) -- checkSubIssueLinkage already knows
// how to flag an Epic/Story with zero sub-issues; recognizing this action
// lets that same check also fire right after a link is added, catching
// the case where the call succeeded but the parent still shows zero (wrong
// parent, a GitHub-side rejection that didn't surface as an error).
const SUB_ISSUE_LINK_ACTIONS = new Set(['add_sub_issue']);
// No separate `request_copilot_review` tool exists in this marketplace
// today (Copilot review is `request_review` with `reviewers: ["Copilot"]`)
// -- kept in the set anyway for forward-compat at zero cost, matching this
// codebase's own precedent (STATUS_MUTATE_ACTIONS already lists actions
// from more than one real tool). No dedicated check function fires on
// this one: recognizing it is the whole fix, so it's scratch-logged for
// hygiene-aggregate.mjs's end-of-turn report instead of silently invisible.
const REVIEW_REQUEST_ACTIONS = new Set(['request_review', 'request_copilot_review']);
const SYNC_FIELD_ACTIONS = new Set(['sync_linked_issues_project_field']);

/** `mcp__github__issue_write`'s action name alone doesn't distinguish a
 * create from an update to an existing issue -- its own `method` field
 * does. Remaps it onto the same `create_issue`/`update_issue` action
 * names the plugin-scoped tools already use, so every check downstream
 * triggers identically regardless of which MCP surface performed the
 * touch, instead of silently never triggering for this tool at all. */
function normalizeMcpAction(action, toolInput) {
  if (action !== 'issue_write') return action;
  return toolInput?.method === 'create' ? 'create_issue' : 'update_issue';
}

/** Code-review finding: extractTouch's `number` derivation had grown into
 * an unreadable nested-ternary chain, one branch added per tool onboarded
 * (four onboarding passes so far: the original two, then gdlc#201/#210's
 * pullNumber, then gdlc#203/#212's three more actions). Returns the first
 * argument that is actually a number, in the caller's own precedence
 * order -- a flat, ordered list of candidates reads as "try these in
 * order" instead of a pile of `cond ? a : cond ? b : ...`, and a future
 * tool with yet another field name is one more argument, not one more
 * nested branch inserted in exactly the right position. */
function firstNumber(...candidates) {
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate;
  }
  return null;
}

/** `Closes #N` / `Fixes #N` / `Resolves #N` (any case, singular or plural
 * keyword) referencing a same-repo issue -- the same closing-keyword set
 * GitHub itself recognizes. Best-effort text scan over whatever the tool
 * call's title/body carries; a PR body that references an issue some other
 * way (a bare `#N` mention, a cross-repo `owner/repo#N`) is out of scope for
 * this narrow check, which only ever degrades to "no finding", never a
 * false guess. */
const CLOSING_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;

function extractClosedIssueNumbers(text) {
  if (typeof text !== 'string') return [];
  const numbers = new Set();
  for (const match of text.matchAll(CLOSING_KEYWORD_RE)) numbers.add(Number(match[1]));
  return [...numbers];
}

/** gdlc#201: matches a closing keyword followed by a comma-separated run of
 * `#N` references (`Closes #A, #B, #C`) -- the exact syntax GitHub's own
 * closing-keyword parser silently mishandles: it honors only the FIRST `#N`
 * immediately after the keyword and treats every comma-continuation as a
 * plain, non-closing mention. A PR author writing this almost always means
 * to close all of them (session 1f3d575b's PR #368 did exactly this and
 * nearly left 3 of 4 issues open post-merge). The capture group grabs the
 * whole run so `detectCommaSeparatedClosingKeywords` can pull every `#N`
 * out of it, not just the first. */
const CLOSING_KEYWORD_LIST_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*((?:#\d+\s*,\s*)+#\d+)/gi;

/** Returns the issue numbers GitHub will silently NOT auto-close because
 * they appear as a comma-continuation after a closing keyword rather than
 * their own keyword -- i.e. every `#N` in a matched run except the first.
 * A clause with only one `#N` (the unambiguous, correct form) never
 * matches `CLOSING_KEYWORD_LIST_RE` at all, so this never flags it. */
export function detectCommaSeparatedClosingKeywords(text) {
  if (typeof text !== 'string') return [];
  const dropped = new Set();
  for (const match of text.matchAll(CLOSING_KEYWORD_LIST_RE)) {
    const numbers = [...match[1].matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    for (const n of numbers.slice(1)) dropped.add(n);
  }
  return [...dropped];
}

// Exported so the entrypoint can cheaply pre-check a Bash command before
// deciding whether it's worth shelling out to `git remote get-url origin`
// for the owner/repo fallback -- this hook runs on every Bash tool call
// (the matcher is unscoped), so that shell-out must not happen for the
// common case of an unrelated command (`ls`, `npm test`, ...).
export const GH_ISSUE_OR_PR_RE = /^\s*gh\s+(issue|pr)\s+(view|edit|close|comment|create|list|merge)\b/;

/** Extracts a `gh ... create`'s `--body "..."` flag value. `--body-file`/
 * `--fill` read from a file or commit messages this hook cannot see without
 * shelling out again, so those forms yield `''` rather than guessing --
 * both this function's two callers (closed-issue extraction, comma-list
 * detection) treat an empty string as "nothing found", a narrower
 * detection than the MCP-tool path, not a wrong one. */
function extractBodyFlag(command) {
  const bodyFlag = /--body(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command);
  return bodyFlag ? (bodyFlag[1] ?? bodyFlag[2] ?? bodyFlag[3] ?? '') : '';
}

/** A Bash tool_output may arrive as a plain string or an object carrying
 * stdout/stderr/output fields -- same shape github-bug-capture's
 * diagnostic-capture.mjs already handles. */
function extractOutputText(toolOutput) {
  if (toolOutput == null) return '';
  if (typeof toolOutput === 'string') return toolOutput;
  if (typeof toolOutput !== 'object') return '';
  const parts = [];
  for (const key of ['output', 'stdout', 'stderr']) {
    const value = toolOutput[key];
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n');
}

/** An MCP tool's `tool_output` may arrive as a JSON string, an
 * already-parsed flat object, or the MCP content-array shape
 * (`{content:[{type:'text', text:'...'}]}`) -- same three shapes
 * ../validate-mif.mjs's `extractBody` already handles for this exact tool
 * family. Returns a flat object to read fields from, or `null` if none of
 * the three shapes match. */
function normalizeToolOutput(toolOutput) {
  let value = toolOutput;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value.content)) {
    const textPart = value.content.find((part) => typeof part?.text === 'string');
    if (!textPart) return null;
    try {
      const inner = JSON.parse(textPart.text);
      return inner !== null && typeof inner === 'object' ? inner : null;
    } catch {
      return null;
    }
  }
  return value;
}

/** `gh issue create`/`gh pr create` print the new item's URL to stdout
 * (e.g. `https://github.com/acme/widgets/issues/123`) -- the only place
 * its number appears, since the command's own input never carries a
 * not-yet-assigned number. Returns `null` if the output doesn't contain a
 * recognizable URL for `pathSegment` (`issues` or `pull`), never a guess. */
function extractNumberFromGhUrl(text, pathSegment) {
  const match = new RegExp(`/${pathSegment}/(\\d+)\\b`).exec(text);
  return match ? Number(match[1]) : null;
}

const GH_REPO_FLAG_RE = /(?:^|\s)(?:-R|--repo)(?:=|\s+)(?:"([^"]+)"|'([^']*)'|(\S+))/;

/** An explicit `-R owner/repo` / `--repo owner/repo` flag on a `gh`
 * command always overrides the cwd-derived fallback -- ignoring it would
 * silently attribute the touch to whatever repo the hook process happens
 * to be running in, which is wrong whenever the command targets a
 * different repo than the checkout it's run from, and could produce a
 * false lifecycle-comment reminder against the wrong repo (violating the
 * "never warn falsely" contract). Returns `undefined` when the flag isn't
 * present at all (caller should use the cwd fallback), `null` when it's
 * present but its value doesn't parse as `owner/repo` (never guess -- the
 * cwd fallback is not a safe substitute for an explicit-but-broken flag),
 * or `{owner, repo}` when it parses cleanly. */
export function parseGhRepoFlag(command) {
  const match = GH_REPO_FLAG_RE.exec(command);
  if (!match) return undefined;
  const raw = match[1] ?? match[2] ?? match[3] ?? '';
  const parts = raw.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}

/** Normalize one PostToolUse hook invocation into `{ surface, action,
 * owner, repo, number, closing, closesIssues, itemId }`, or `null` if this
 * call touches nothing this hook tracks. `owner`/`repo` fall back to the
 * repo this hook itself runs in when a tool call's own input doesn't carry
 * them (the common case for `gh` CLI calls run from a repo checkout) --
 * this fallback is only ever populated by the entrypoint for a
 * Bash-surfaced call today, so an MCP touch's `owner`/`repo` end up `null`
 * whenever the tool's own input doesn't carry them either, but that's a
 * property of the current caller, not something this function itself
 * guarantees. `closing` is `true` only for a call that closes an existing
 * issue/PR -- checkSubIssueLinkage skips those (closing an empty Epic/Story
 * is a different problem than not-yet-linked, see that check's own
 * docstring); checkLifecycleComment makes no such distinction, since a
 * close is itself a transition worth a comment like any other. `itemId` is
 * only ever set for a `set_field_value` touch (issue #172) -- that tool's
 * own input/output carries no issue coordinates at all, only `itemId`/
 * `fieldId`, so `number` is always `null` for this action specifically;
 * checkLifecycleComment resolves `itemId` to real coordinates itself. */
export function extractTouch(input, fallbackOwnerRepo) {
  const toolName = input?.tool_name;
  const toolInput = input?.tool_input;
  const toolOutput = input?.tool_output;

  if (toolName === 'Bash') {
    const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
    const match = GH_ISSUE_OR_PR_RE.exec(command);
    if (!match) return null;
    const [, kind, subcommand] = match;
    const repoFlag = parseGhRepoFlag(command);
    // repoFlag === undefined: no -R/--repo flag at all, use the cwd
    // fallback. repoFlag === null: the flag was present but unparseable,
    // never fall back to (possibly wrong) cwd-derived coordinates for an
    // explicitly-targeted command. Otherwise: the flag's own value wins.
    const owner = repoFlag === undefined ? (fallbackOwnerRepo?.owner ?? null) : (repoFlag?.owner ?? null);
    const repo = repoFlag === undefined ? (fallbackOwnerRepo?.repo ?? null) : (repoFlag?.repo ?? null);
    const outputText = extractOutputText(toolOutput);

    if (subcommand === 'create') {
      if (kind === 'pr') {
        const rawBody = extractBodyFlag(command);
        const closesIssues = extractClosedIssueNumbers(rawBody).map((number) => ({ owner, repo, number }));
        const droppedClosingIssues = detectCommaSeparatedClosingKeywords(rawBody);
        return { surface: 'gh-cli', action: 'create_pull_request', owner, repo, number: extractNumberFromGhUrl(outputText, 'pull'), closing: false, closesIssues, droppedClosingIssues };
      }
      // `gh issue create`: an issue-creation touch, same action name the
      // MCP-tool path uses, so checkSubIssueLinkage/checkLifecycleComment
      // trigger identically regardless of which surface created it.
      return { surface: 'gh-cli', action: 'create_issue', owner, repo, number: extractNumberFromGhUrl(outputText, 'issues'), closing: false, closesIssues: [], droppedClosingIssues: [] };
    }

    // For every other subcommand, the target number is the first bare
    // number immediately following it (`gh issue edit 42 ...`), never a
    // number found anywhere later in the command (a title/body containing
    // a digit must never be mistaken for the target number).
    const rest = command.slice(match[0].length);
    const numberMatch = /^\s*#?(\d+)\b/.exec(rest);
    const number = numberMatch ? Number(numberMatch[1]) : null;

    if (subcommand === 'edit' || subcommand === 'close') {
      return { surface: 'gh-cli', action: 'update_issue', owner, repo, number, closing: subcommand === 'close', closesIssues: [], droppedClosingIssues: [] };
    }
    if (subcommand === 'merge') {
      return { surface: 'gh-cli', action: 'merge_pull_request', owner, repo, number, closing: false, closesIssues: [], droppedClosingIssues: [] };
    }
    // view/list/comment: not a check-triggering transition itself (a
    // comment command is what checkLifecycleComment's own transcript scan
    // looks FOR, not a subject of these checks) -- recognized as a touch
    // for scratch-file bookkeeping, but no check fires on it.
    return { surface: 'gh-cli', action: 'gh_command', owner, repo, number, closing: false, closesIssues: [], droppedClosingIssues: [] };
  }

  const rawAction = mcpAction(toolName);
  if (rawAction === null) return null;
  const action = normalizeMcpAction(rawAction, toolInput);

  const relevant =
    PR_CREATE_ACTIONS.has(action) ||
    ISSUE_CREATE_ACTIONS.has(action) ||
    STATUS_MUTATE_ACTIONS.has(action) ||
    COMMENT_ACTIONS.has(action) ||
    PR_MERGE_ACTIONS.has(action) ||
    SUB_ISSUE_LINK_ACTIONS.has(action) ||
    REVIEW_REQUEST_ACTIONS.has(action) ||
    SYNC_FIELD_ACTIONS.has(action);
  if (!relevant) return null;

  const normalizedOutput = normalizeToolOutput(toolOutput);
  const owner = toolInput?.owner ?? fallbackOwnerRepo?.owner ?? null;
  const repo = toolInput?.repo ?? fallbackOwnerRepo?.repo ?? null;
  const closing = action === 'update_issue' && toolInput?.state === 'closed';
  // A create call's own tool_input never carries the new issue/PR's number
  // (it doesn't exist yet when the call is made) -- fall back to the
  // tool's output, which returns it (create_issue: {number, ...}). A merge
  // or PR-scoped-tool call's number arrives as `pullNumber` (the generic
  // github MCP server's field name for merge_pull_request, and this
  // marketplace's own field name for request_review/
  // sync_linked_issues_project_field), never `number`/`issue_number` --
  // checked last so it never shadows those for any other action.
  // `add_sub_issue`'s own `parentNumber`/`childNumber` split is handled
  // separately below (this touch's `number` is deliberately the PARENT,
  // not the newly-linked child) since neither generic fallback name
  // applies to it.
  const number =
    action === 'add_sub_issue'
      ? firstNumber(toolInput?.parentNumber)
      : firstNumber(
          toolInput?.number,
          toolInput?.issue_number,
          normalizedOutput?.number,
          normalizedOutput?.issue_number,
          toolInput?.pullNumber,
          toolInput?.pull_number,
        );

  let closesIssues = [];
  let droppedClosingIssues = [];
  if (PR_CREATE_ACTIONS.has(action)) {
    const bodyText = [toolInput?.body, normalizedOutput?.body].filter((v) => typeof v === 'string').join('\n');
    closesIssues = extractClosedIssueNumbers(bodyText).map((n) => ({ owner, repo, number: n }));
    droppedClosingIssues = detectCommaSeparatedClosingKeywords(bodyText);
  }

  // gdlc#203/#212: sync_linked_issues_project_field's own result already
  // names exactly which linked issues it could NOT find on the board
  // (gdlc#200's now-fixed pagination bug's most visible symptom) -- surface
  // it if it ever recurs (a different board, a genuinely-missing item)
  // rather than silently discarding a signal the tool call itself already
  // computed for free.
  const notFoundOnBoard =
    SYNC_FIELD_ACTIONS.has(action) && Array.isArray(normalizedOutput?.notFoundOnBoard)
      ? normalizedOutput.notFoundOnBoard.filter((n) => typeof n === 'number')
      : [];

  // set_field_value's own input/output carries itemId/fieldId, not
  // owner/repo/number, since a Projects v2 item is addressed by itemId,
  // not issue coordinates (issue #172). Carried through here as a
  // passthrough field, checked in both tool_input and (as a fallback)
  // tool_output -- SetFieldValueResult echoes itemId back too -- the same
  // input-then-output fallback shape `number` already uses a few lines
  // above. checkLifecycleComment resolves it to owner/repo/number via an
  // async GraphQL round trip when needed, since extractTouch itself stays
  // synchronous and dependency-free by design.
  const itemId =
    action === 'set_field_value'
      ? typeof toolInput?.itemId === 'string' ? toolInput.itemId
        : typeof normalizedOutput?.itemId === 'string' ? normalizedOutput.itemId
        : null
      : null;

  return {
    surface: toolName.startsWith('mcp__github__') ? 'generic-github-mcp' : 'plugin-mcp',
    action,
    owner,
    repo,
    number,
    closing,
    closesIssues,
    droppedClosingIssues,
    itemId,
    notFoundOnBoard,
  };
}

// ---------------------------------------------------------------------------
// Check 1: status-progression -- scoped ONLY to the In-Review gap.
// ---------------------------------------------------------------------------

export const ISSUE_STATUS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 20) {
          nodes {
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

function extractStatusName(data) {
  const nodes = data?.repository?.issue?.projectItems?.nodes ?? [];
  for (const item of nodes) {
    const statusValue = (item.fieldValues?.nodes ?? []).find((fv) => fv.field?.name === 'Status');
    if (statusValue) return statusValue.name ?? null;
  }
  return undefined; // not on any tracked board
}

const STATUS_PROGRESSION_SKIP = new Set(['In Review', 'Done', 'Blocked']);

/** WHEN a PR was just opened closing one or more issues, THEN for each
 * closed issue whose board Status is not already In Review/Done/Blocked,
 * surface a suggestion to move it to In Review. Never touches Todo, In
 * Progress, or Done -- those remain native automation's and
 * in-progress.mjs's territory (ADR-0003). Fails open per closed-issue ref
 * independently: a GraphQL error or an issue not on any tracked board
 * yields no finding for that ref, never a thrown error and never a guess. */
export async function checkStatusProgression(touch, runGraphQL) {
  if (!touch || touch.closesIssues.length === 0) return { resolved: true, findings: [] };

  const findings = [];
  for (const ref of touch.closesIssues) {
    if (typeof ref.owner !== 'string' || typeof ref.repo !== 'string') continue;
    try {
      const data = await runGraphQL(ISSUE_STATUS_QUERY, { owner: ref.owner, repo: ref.repo, number: ref.number });
      const status = extractStatusName(data);
      if (status === undefined || status === null) continue; // not tracked, or no Status yet: silent no-op
      if (!STATUS_PROGRESSION_SKIP.has(status)) {
        findings.push(`${ref.owner}/${ref.repo}#${ref.number}: PR references it but board Status is still "${status}" -- consider moving it to In Review.`);
      }
    } catch {
      // fail open for this ref only; other refs and other checks are unaffected
    }
  }
  return { resolved: true, findings };
}

// ---------------------------------------------------------------------------
// Check 1b: closing-keyword syntax -- gdlc#201/forensics root cause #1.
// ---------------------------------------------------------------------------

/** WHEN a just-opened PR's body uses a comma-separated closing-keyword list
 * (`Closes #A, #B, #C`), THEN flag the numbers GitHub will silently NOT
 * auto-close (everything after the first). Purely synchronous text
 * analysis -- no GraphQL round trip, so this never needs to fail open on a
 * network error the way the other checks do; the only "no finding" case is
 * a body with no such pattern at all. */
export function checkClosingKeywordSyntax(touch) {
  if (!touch || !touch.droppedClosingIssues || touch.droppedClosingIssues.length === 0) {
    return { resolved: true, findings: [] };
  }
  const refs = touch.droppedClosingIssues.map((n) => `#${n}`).join(', ');
  return {
    resolved: true,
    findings: [
      `PR body uses a comma-separated closing-keyword list -- GitHub only auto-closes the FIRST issue after the ` +
        `keyword. ${refs} will stay open after merge unless each gets its own \`Closes #N\` (one per line) or is ` +
        `closed manually.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Check 1c: post-merge closing-keyword verification -- gdlc#201/#210.
// Defense in depth for when checkClosingKeywordSyntax's pre-merge warning
// was ignored, missed, or the PR body was edited after creation.
// ---------------------------------------------------------------------------

export const PR_MERGE_STATE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) { merged body }
    }
  }
`;

export const ISSUE_STATE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { state }
    }
  }
`;

/** WHEN a PR merge touch fires, THEN re-read the PR's own body (not the
 * touch's cached one -- the body may have changed between creation and
 * merge) and confirm every issue it references via a closing keyword
 * (both correctly-parsed AND comma-dropped -- see
 * `detectCommaSeparatedClosingKeywords`) is actually `CLOSED` now. This is
 * the defense-in-depth half of gdlc#201: `checkClosingKeywordSyntax` warns
 * BEFORE creation, this catches the case where that warning was missed,
 * ignored, or the body changed after the PR was opened. Fails open on any
 * unresolvable step (PR not found, not actually merged yet, a GraphQL
 * error) -- never a guess, matching every other check in this file. */
export async function checkPostMergeClosingKeywords(touch, runGraphQL) {
  if (!touch || !PR_MERGE_ACTIONS.has(touch.action) || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    return { resolved: true, findings: [] };
  }
  let pr;
  try {
    const data = await runGraphQL(PR_MERGE_STATE_QUERY, { owner: touch.owner, repo: touch.repo, number: touch.number });
    pr = data?.repository?.pullRequest;
  } catch {
    return { resolved: true, findings: [] };
  }
  if (!pr || pr.merged !== true) return { resolved: true, findings: [] }; // not actually merged: nothing to verify yet

  const referenced = new Set([...extractClosedIssueNumbers(pr.body), ...detectCommaSeparatedClosingKeywords(pr.body)]);
  if (referenced.size === 0) return { resolved: true, findings: [] };

  const stillOpen = [];
  for (const number of referenced) {
    try {
      const data = await runGraphQL(ISSUE_STATE_QUERY, { owner: touch.owner, repo: touch.repo, number });
      const state = data?.repository?.issue?.state;
      if (state === 'OPEN') stillOpen.push(number);
    } catch {
      // fail open for this ref only; other refs and other checks are unaffected
    }
  }
  if (stillOpen.length === 0) return { resolved: true, findings: [] };
  const refs = stillOpen.map((n) => `#${n}`).join(', ');
  return {
    resolved: true,
    findings: [
      `${touch.owner}/${touch.repo}#${touch.number} merged, but ${refs} (referenced via a closing keyword in its body) ` +
        `${stillOpen.length === 1 ? 'is' : 'are'} still open -- likely the comma-separated closing-keyword gap; verify and close manually if intended.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Check 2: lifecycle-comment -- was a comment posted alongside this
// transition, anywhere earlier in this turn's transcript.
// ---------------------------------------------------------------------------

const TRANSCRIPT_TAIL_BYTES = 262144; // 256 KiB

/** Read only the last `TRANSCRIPT_TAIL_BYTES` of a transcript file rather
 * than the whole thing. This check runs on every qualifying touch, not
 * once per session, and a session transcript can grow arbitrarily large --
 * unlike github-bug-capture's diagnostic-capture.mjs, which layers a
 * high-water-mark on top of its own tail read to guard against
 * self-matching its own prior output (issue #146), this check has no such
 * self-matching risk, so a plain bounded tail read is sufficient. Same
 * "informational only" tradeoff diagnostic-capture.mjs already accepts: a
 * comment posted earlier than this window may be missed, degrading to a
 * slightly noisier reminder, never a crash or a wrongly-suppressed
 * unrelated finding. Matches the `(path, encoding) => string` shape of
 * `node:fs`'s `readFileSync` so it's a drop-in default for `readFn` below,
 * including in tests, whose small fixture files are entirely within one
 * tail window regardless. */
function readTranscriptTail(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const position = Math.max(0, size - TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, position);
    return buffer.toString('utf8');
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // already closed or never opened; nothing to clean up
      }
    }
  }
}

/** A real Claude Code session transcript line is an `{type, message}` entry
 * whose `message.content` is an array of blocks (text and/or `tool_use`) --
 * ONE assistant turn commonly carries several tool calls as sibling blocks
 * on the SAME line, keyed by `name`/`input`, never a bare `tool_name`/
 * `tool_input`. gdlc#289: the prior version of this scan only ever checked
 * `entry.tool_name`/`entry.message.tool_name` (singular, flat fields that
 * no real transcript line has), so it silently matched nothing at all --
 * not just MCP comment tools, but a same-turn literal `gh issue comment 42`
 * sitting alongside another tool call in one multi-tool-use assistant
 * message too, which is the dominant shape a batch of paired
 * comment+transition calls actually takes. The flat shape is kept as a
 * fallback since it's what this file's own unit tests (and any other
 * hook-input-shaped fixture) construct. Returns every tool call found on
 * the line, since a single line can carry more than one. */
function extractToolCallsFromEntry(entry) {
  const content = entry?.message?.content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block && block.type === 'tool_use' && typeof block.name === 'string' && block.input)
      .map((block) => ({ toolName: block.name, toolInput: block.input, toolUseId: typeof block.id === 'string' ? block.id : undefined }));
  }
  const toolName = entry?.tool_name ?? entry?.message?.tool_name;
  const toolInput = entry?.tool_input ?? entry?.message?.tool_input;
  return toolName && toolInput ? [{ toolName, toolInput, toolUseId: undefined }] : [];
}

// gdlc#320: matches ANY `gh issue comment` / `gh pr comment` invocation,
// regardless of whether a literal issue number follows -- deliberately
// broader than the digit-anchored regex used by the literal-number match
// below. This one exists only to decide whether a Bash call is worth also
// trying the output-based match (matchesCommentUrlInOutput) against; it
// never resolves `sameIssue` by itself.
const GH_COMMENT_BASH_RE = /\bgh\s+(?:issue|pr)\s+comment\b/;

/** A `tool_result` block's own `content` field is either a bare string or
 * an array of `{type:'text', text}` blocks -- the same two shapes
 * `normalizeToolOutput` above already handles for a different caller
 * (this scan is dependency-free and deliberately doesn't share code across
 * that boundary, matching this file's existing per-caller normalization
 * pattern). */
function toolResultContentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => typeof b?.text === 'string').map((b) => b.text).join('\n');
  }
  return '';
}

/** gdlc#320: a real transcript's `tool_result` block (the "user" role turn
 * immediately following the assistant turn that made the call) carries the
 * Bash/MCP tool's own stdout, keyed by `tool_use_id` back to the
 * `tool_use` block that produced it -- on a LATER line than that
 * `tool_use` block, never embedded on the same line (see
 * extractToolCallsFromEntry's own doc comment for why this scan otherwise
 * never reads tool output at all). Scans the whole (already tail-bounded)
 * transcript text once, building an id-to-output map the main scan loop
 * below can look up by `toolUseId`, rather than re-scanning per lookup. */
function buildToolResultOutputs(text) {
  const outputs = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const content = entry?.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        outputs.set(block.tool_use_id, toolResultContentText(block.content));
      }
    }
  }
  return outputs;
}

/** Escapes every regex-special character in a literal string segment
 * before splicing it into a dynamically-built RegExp -- `owner`/`repo` are
 * caller-controlled strings (GitHub logins/repo names), not regex source,
 * and must never be interpreted as pattern syntax. */
function escapeRegExpLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** gdlc#320: true if `output` (a Bash tool_result's stdout) contains the
 * URL `gh issue comment` / `gh pr comment` prints on success for THIS
 * specific owner/repo/number -- `.../issues/<number>#issuecomment-<id>` or
 * `.../pull/<number>#issuecomment-<id>`. Unlike the literal-number regex
 * below, this needs no `--repo`/`-R` flag heuristic at all: the URL itself
 * already names the real owner/repo/number the comment landed on, so a
 * same-numbered issue in a different repo can never false-match here the
 * way it could from command text alone (see checkLifecycleComment's own
 * gdlc#278 note on that heuristic). This is also the fix for the shape
 * gdlc#320 was filed against: a shell `for` loop invoking the command
 * several times in one Bash call (`for n in ...; do gh issue comment $n
 * ...; done`) prints one URL per invocation, concatenated in `output` --
 * this only needs ONE of them to match `ref`, and works identically
 * whether the command's own text used a literal number, a variable, or a
 * loop iterator, since it never has to statically resolve the command
 * text at all. */
function matchesCommentUrlInOutput(output, ref) {
  const re = new RegExp(`github\\.com/${escapeRegExpLiteral(ref.owner)}/${escapeRegExpLiteral(ref.repo)}/(?:issues|pull)/${ref.number}#issuecomment-\\d+`);
  return re.test(output);
}

/** Best-effort: scans the JSONL transcript for an `add_issue_comment` call
 * (plugin-scoped or the generic github MCP server's own comment tool --
 * NOT `issue_write`, which has no comment-posting semantics, see
 * COMMENT_ACTIONS above) or a `gh issue comment` / `gh pr comment` Bash
 * call, referencing the same owner/repo/number anywhere in the
 * (tail-bounded) file. An unreadable/missing transcript is itself a
 * silent no-op for this check specifically -- it never suppresses the
 * other two checks (NFR-5). gdlc#320: a `gh issue comment` Bash call whose
 * own command text has no literal issue number at all -- a shell variable
 * or a `for`-loop iterator (`gh issue comment $n`) -- is statically
 * unresolvable from the command string alone, so this also checks the
 * call's own tool_result output (correlated by `tool_use_id`) for the
 * comment URL `gh` prints on success, which always names the real issue
 * number regardless of how the command computed it (see
 * matchesCommentUrlInOutput). A transcript fixture with no `tool_result`
 * blocks at all (every pre-#320 fixture) simply finds no output to match,
 * falling back to the pre-existing literal-number behavior unchanged. */
export function scanTranscriptForComment(transcriptPath, ref, readFn = readTranscriptTail) {
  if (!transcriptPath || !ref || typeof ref.owner !== 'string' || typeof ref.repo !== 'string') {
    return { resolved: false };
  }
  let text;
  try {
    text = readFn(transcriptPath, 'utf8');
  } catch {
    return { resolved: false };
  }
  const toolResultOutputs = buildToolResultOutputs(text);

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    for (const { toolName, toolInput, toolUseId } of extractToolCallsFromEntry(entry)) {
      const action = toolName === 'Bash' ? null : mcpAction(toolName);
      const isCommentTool = action !== null && COMMENT_ACTIONS.has(action);
      const isBashCommentCommand = toolName === 'Bash' && typeof toolInput.command === 'string' && GH_COMMENT_BASH_RE.test(toolInput.command);
      if (!isCommentTool && !isBashCommentCommand) continue;

      if (isCommentTool) {
        const sameIssue = toolInput.owner === ref.owner && toolInput.repo === ref.repo && (toolInput.number === ref.number || toolInput.issue_number === ref.number);
        if (sameIssue) return { resolved: true, found: true };
        continue;
      }

      // isBashCommentCommand: try the literal-number match first (cheap,
      // no output needed), then fall back to the output-based match for a
      // variable/loop-iterator command the literal match can't resolve.
      const ghCommentMatch = /\bgh\s+(?:issue|pr)\s+comment\s+#?(\d+)\b/.exec(toolInput.command);
      if (ghCommentMatch !== null) {
        const sameNumber = Number(ghCommentMatch[1]) === ref.number;
        // gdlc#278 round-2 Copilot finding: this scan is now also called at
        // Stop time across a whole turn (not just narrowly at PostToolUse,
        // its original use), so a same-turn `gh issue comment <N> --repo
        // other/other-repo` sharing the SAME issue NUMBER as `ref` in a
        // DIFFERENT repo must never count as a match -- that would wrongly
        // suppress a genuine lifecycle-comment reminder for `ref`'s own
        // repo. An explicit, parseable -R/--repo flag that disagrees with
        // `ref` rules the match out. No flag at all (or one that doesn't
        // parse as owner/repo) keeps the prior behavior of matching by
        // number alone -- this scan has no cwd context of its own to
        // resolve an unflagged command's real target repo, and "no flag,
        // same repo" is the dominant real-world pattern this scan exists to
        // recognize (see parseGhRepoFlag's own doc comment for the same
        // never-guess-when-ambiguous rationale `extractTouch` already
        // applies to this exact flag).
        const repoFlag = sameNumber ? parseGhRepoFlag(toolInput.command) : undefined;
        const sameIssue = sameNumber && (repoFlag == null || (repoFlag.owner === ref.owner && repoFlag.repo === ref.repo));
        if (sameIssue) return { resolved: true, found: true };
      }

      const output = toolUseId ? toolResultOutputs.get(toolUseId) : undefined;
      if (typeof output === 'string' && matchesCommentUrlInOutput(output, ref)) {
        return { resolved: true, found: true };
      }
    }
  }
  return { resolved: true, found: false };
}

export const ISSUE_RECENT_COMMENTS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        comments(last: 5) {
          nodes { createdAt }
        }
      }
    }
  }
`;

// gdlc#324: five minutes comfortably covers both blind spots this fallback
// exists for -- a background subagent's own tool calls (which run to
// completion, including its own GitHub API round trips, before control
// returns to the parent) and a same-turn parallel-dispatch race (the two
// calls' underlying network requests are rarely more than a few seconds
// apart even when their transcript writes land out of order) -- without
// being so wide that an unrelated, genuinely-later comment on a slow-moving
// issue gets mistaken for "posted this turn".
const RECENT_COMMENT_WINDOW_MS = 5 * 60 * 1000;

/** gdlc#324: live fallback for `checkLifecycleComment` when the local
 * transcript scan (`scanTranscriptForComment`) finds nothing. That scan is
 * structurally blind to two real cases: (1) a lifecycle comment posted by a
 * background workflow subagent -- a subagent's tool calls execute and are
 * logged in ITS OWN transcript, never the parent session's, so no amount of
 * parent-transcript scanning can ever see it; and (2) a same-turn parallel
 * tool-call dispatch, where a comment call's own `tool_result` may not yet
 * be flushed to the transcript file at the instant this check runs even
 * though the underlying GitHub API call already completed. Querying GitHub
 * directly sidesteps the transcript file entirely, closing both: case (1)
 * because the subagent's own API call has, by definition, already completed
 * by the time the parent resumes and makes its own transition call; case
 * (2) to whatever extent the comment's underlying network request has
 * already completed even if its local bookkeeping hasn't caught up yet --
 * not a full guarantee under a truly simultaneous start, but strictly
 * better than relying on the local transcript alone (see this issue's own
 * discussion of "failing open more gracefully" under that race window).
 *
 * Deliberately over-inclusive: this counts ANY comment on the issue created
 * within `windowMs` of `nowMs`, not just one from the acting user -- the
 * same "advisory nudge" tolerance for false negatives over false positives
 * `checkLifecycleComment` itself already documents. A coincidental,
 * unrelated comment from someone else inside the window degrades this to a
 * missed reminder (tolerable), never fabricates a match when the window
 * genuinely has no comment in it at all. Fails open (returns `false`, i.e.
 * "no live confirmation") on a missing `runGraphQL`, a malformed response,
 * or any thrown error -- never a guess, matching every other check in this
 * file; the caller's own pre-existing transcript-only finding stands
 * whenever this fallback can't positively confirm otherwise. */
export async function checkRecentCommentViaGraphQL(identity, runGraphQL, { windowMs = RECENT_COMMENT_WINDOW_MS, nowMs = Date.now() } = {}) {
  if (typeof runGraphQL !== 'function' || typeof identity?.owner !== 'string' || typeof identity?.repo !== 'string' || typeof identity?.number !== 'number') {
    return false;
  }
  try {
    const data = await runGraphQL(ISSUE_RECENT_COMMENTS_QUERY, { owner: identity.owner, repo: identity.repo, number: identity.number });
    const nodes = data?.repository?.issue?.comments?.nodes;
    if (!Array.isArray(nodes)) return false;
    return nodes.some((node) => {
      const createdAt = typeof node?.createdAt === 'string' ? Date.parse(node.createdAt) : NaN;
      return !Number.isNaN(createdAt) && Math.abs(nowMs - createdAt) <= windowMs;
    });
  } catch {
    return false;
  }
}

export const RESOLVE_PROJECT_ITEM_QUERY = `
  query($itemId: ID!) {
    node(id: $itemId) {
      ... on ProjectV2Item {
        content {
          ... on Issue { number repository { owner { login } name } }
          ... on PullRequest { number repository { owner { login } name } }
        }
      }
    }
  }
`;

/** Resolve a Projects v2 item's `itemId` to the issue/PR it belongs to --
 * the only network call a `set_field_value` touch needs, since that
 * tool's own input/output carries no issue coordinates at all, only
 * `itemId`/`fieldId` (issue #172). Returns `null` on any ambiguity (a
 * Draft Issue item with no linked `content`, a malformed response, a
 * GraphQL error) -- never a guess. */
export async function resolveItemIdentity(itemId, runGraphQL) {
  try {
    const data = await runGraphQL(RESOLVE_PROJECT_ITEM_QUERY, { itemId });
    const content = data?.node?.content;
    const owner = content?.repository?.owner?.login;
    const repo = content?.repository?.name;
    const number = content?.number;
    if (typeof owner !== 'string' || typeof repo !== 'string' || typeof number !== 'number') return null;
    return { owner, repo, number };
  } catch {
    return null;
  }
}

/** WHEN a Status-mutating or issue-creating action touches a tracked issue,
 * THEN check whether a lifecycle comment accompanies it this turn.
 * Deliberately over-inclusive about which actions count as "a transition"
 * (any `set_field_value`/`update_issue`/`create_issue` call, not just a
 * Status-field change this hook cannot identify from a bare `fieldId`) --
 * an acceptable false-positive rate for an advisory nudge, not a violation
 * of the "never guess" NFR, which governs the resolved/unresolved
 * distinction, not this heuristic's precision. For a `set_field_value`
 * touch, `touch.number` is always null -- that tool's own input/output
 * carries no issue coordinates at all (see extractTouch's doc comment).
 * `touch.owner`/`repo` are `null` too given how this hook's own entrypoint
 * calls `extractTouch` today (the `fallbackOwnerRepo` it passes is only
 * ever populated for a Bash-surfaced call, never for an MCP one), but
 * that's an artifact of the current caller, not an invariant `extractTouch`
 * itself enforces -- this function still branches on `touch.itemId`
 * specifically, not on `owner`/`repo` being unset, so it doesn't depend on
 * that artifact holding. Its `itemId` is resolved to real issue
 * coordinates via `resolveItemIdentity` first, failing open (no finding)
 * if resolution doesn't succeed, the same as every other unresolvable
 * case here.
 *
 * gdlc#324: when the transcript scan resolves but finds nothing, that's
 * exactly the signature of two blind spots the scan structurally cannot
 * see (a background subagent's own comment, or a same-turn parallel-
 * dispatch race -- see `checkRecentCommentViaGraphQL`'s own doc comment)
 * -- so a live GraphQL check gets one more chance to confirm a comment
 * really was posted before this concludes the transition has none. `options`
 * (windowMs/nowMs) passes straight through to that fallback, purely for
 * test injectability -- production callers never need to set it. */
export async function checkLifecycleComment(touch, transcriptPath, readFn, runGraphQL, options) {
  const isTransition = touch && (STATUS_MUTATE_ACTIONS.has(touch.action) || ISSUE_CREATE_ACTIONS.has(touch.action));
  if (!isTransition) return { resolved: true, findings: [] };

  let identity = touch;
  if (touch.action === 'set_field_value' && typeof touch.itemId === 'string') {
    identity = await resolveItemIdentity(touch.itemId, runGraphQL);
    if (!identity) return { resolved: true, findings: [] };
  }

  if (typeof identity.owner !== 'string' || typeof identity.repo !== 'string' || typeof identity.number !== 'number') {
    return { resolved: true, findings: [] };
  }
  const scan = scanTranscriptForComment(transcriptPath, identity, readFn);
  if (!scan.resolved) return { resolved: true, findings: [] }; // unreadable transcript: silent no-op for this check
  if (scan.found) return { resolved: true, findings: [] };
  if (await checkRecentCommentViaGraphQL(identity, runGraphQL, options)) {
    return { resolved: true, findings: [] };
  }
  return { resolved: true, findings: [`${identity.owner}/${identity.repo}#${identity.number}: transitioned with no lifecycle comment found this turn -- consider posting one.`] };
}

// ---------------------------------------------------------------------------
// Check 3: sub-issue-linkage -- an Epic/Story with zero children.
// ---------------------------------------------------------------------------

export const ISSUE_MIF_TYPE_AND_SUBISSUES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        body
        subIssues(first: 1) { totalCount }
      }
    }
  }
`;

const MIF_TYPE_RE = /<!--\s*mif-type:\s*(\w+)\s*-->/;

function extractMifType(body) {
  const match = typeof body === 'string' ? MIF_TYPE_RE.exec(body) : null;
  return match ? match[1] : null;
}

/** WHEN an Epic or Story is created/updated (not closed), THEN flag if it
 * currently has zero sub-issues. Skips any other MIF type (Task/Bug/
 * Feature are leaves) and skips a close (closing an empty Epic/Story is a
 * different problem this check does not speak to). Fails open on a
 * GraphQL error or a body with no recognizable MIF type marker.
 *
 * gdlc#203/#212: also fires on `add_sub_issue` (touch.number is the
 * PARENT, per extractTouch's own doc comment) -- re-checking the parent
 * right after a link is added catches the call succeeding against the
 * wrong parent, or a GitHub-side rejection that didn't surface as a tool
 * error, either of which would otherwise leave the parent looking exactly
 * like it did before the call. */
export async function checkSubIssueLinkage(touch, runGraphQL) {
  const isCreateOrUpdate =
    touch && !touch.closing && (ISSUE_CREATE_ACTIONS.has(touch.action) || touch.action === 'update_issue' || SUB_ISSUE_LINK_ACTIONS.has(touch.action));
  if (!isCreateOrUpdate || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    return { resolved: true, findings: [] };
  }
  try {
    const data = await runGraphQL(ISSUE_MIF_TYPE_AND_SUBISSUES_QUERY, { owner: touch.owner, repo: touch.repo, number: touch.number });
    const mifType = extractMifType(data?.repository?.issue?.body);
    if (mifType !== 'Epic' && mifType !== 'Story') return { resolved: true, findings: [] };
    const totalCount = data?.repository?.issue?.subIssues?.totalCount;
    if (typeof totalCount !== 'number') return { resolved: true, findings: [] }; // ambiguous response: silent no-op
    if (totalCount > 0) return { resolved: true, findings: [] };
    return { resolved: true, findings: [`${touch.owner}/${touch.repo}#${touch.number}: ${mifType} has no sub-issues linked yet.`] };
  } catch {
    return { resolved: true, findings: [] };
  }
}

// ---------------------------------------------------------------------------
// Check 5: sync_linked_issues_project_field's own notFoundOnBoard --
// gdlc#203/#212. Purely synchronous: the tool call already computed this,
// extractTouch just carries it through.
// ---------------------------------------------------------------------------

/** WHEN `sync_linked_issues_project_field` reports one or more linked
 * issues it could not find on the board, THEN surface it loudly instead of
 * letting the caller silently discard a signal the tool already computed.
 * gdlc#200 (this same Epic, an earlier Story) already fixed the pagination
 * bug that was the most likely cause of a false `notFoundOnBoard` on this
 * org's real board, so a genuinely-missing item (never added to the
 * project, added to the wrong project, or removed after being linked) is
 * now the far more likely explanation -- the finding text below reflects
 * that, code-review finding: an earlier revision's wording still pointed
 * at board size as the likely cause, steering readers toward a problem
 * this same PR had already eliminated. */
export function checkSyncNotFoundOnBoard(touch) {
  if (!touch || !touch.notFoundOnBoard || touch.notFoundOnBoard.length === 0) {
    return { resolved: true, findings: [] };
  }
  const refs = touch.notFoundOnBoard.map((n) => `#${n}`).join(', ');
  const where = touch.owner && touch.repo ? ` (${touch.owner}/${touch.repo}#${touch.number})` : '';
  return {
    resolved: true,
    findings: [
      `sync_linked_issues_project_field${where} could not find ${refs} on the board -- verify these issues are actually ` +
        `on the target project (not just some project), or were not accidentally removed from it after being linked.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/** Run all six checks independently -- one check's exception or empty
 * result never suppresses another's finding (NFR-5) -- and flatten into one
 * findings list. Each check function above already fails open internally;
 * this wrapper additionally guards against a check throwing outright, since
 * the entrypoint's own contract (never blocking, never a non-zero exit)
 * must hold even if a check has a latent bug. */
export async function runHygieneChecks(touch, { runGraphQL, transcriptPath, readFn }) {
  const findings = [];
  const results = await Promise.allSettled([
    checkStatusProgression(touch, runGraphQL),
    // checkClosingKeywordSyntax/checkSyncNotFoundOnBoard are synchronous
    // (pure data checks, no GraphQL) -- Promise.allSettled still accepts a
    // plain value here, wrapping it as an already-fulfilled promise, so
    // neither needs special handling to sit alongside its async siblings.
    checkClosingKeywordSyntax(touch),
    checkSyncNotFoundOnBoard(touch),
    checkPostMergeClosingKeywords(touch, runGraphQL),
    // checkLifecycleComment is async (issue #172's fix), so -- same as its
    // two siblings here -- any throw inside it, synchronous or not, is
    // caught by the implicit async-function promise wrapping and never
    // propagates during this array literal's construction; a no-op
    // .then()-deferral wrapper isn't needed to keep the three calls
    // isolated under Promise.allSettled (NFR-5).
    checkLifecycleComment(touch, transcriptPath, readFn, runGraphQL),
    checkSubIssueLinkage(touch, runGraphQL),
  ]);
  for (const result of results) {
    if (result.status === 'fulfilled') findings.push(...result.value.findings);
  }
  return findings;
}

export function buildAdditionalContext(findings) {
  if (findings.length === 0) return null;
  return ['Ticket-hygiene reminder:', ...findings.map((f) => `- ${f}`)].join('\n');
}
