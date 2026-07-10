/**
 * Ticket-hygiene reinforcement hook: the testable core (ADR-0007,
 * docs/decisions/adr-0007-ticket-hygiene-reinforcement-hooks.md).
 *
 * This is the canonical copy (github-sdlc-planning). Sibling plugins
 * (github-pull-requests, github-bug-capture) ship byte-identical copies of
 * this file and its two callers (../hygiene-check.mjs, ../hygiene-aggregate.mjs)
 * -- a build-time drift check (.github/workflows) fails a PR if any copy
 * diverges from this one. Dependency-free by design (no node_modules at
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
import { readFileSync } from 'node:fs';

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
const STATUS_MUTATE_ACTIONS = new Set(['set_field_value', 'update_issue']);
const COMMENT_ACTIONS = new Set(['add_issue_comment', 'issue_write']);

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

const GH_ISSUE_OR_PR_RE = /^\s*gh\s+(issue|pr)\s+(view|edit|close|comment|create|list)\b/;

/** Parse the closing-keyword issue numbers out of a `gh pr create` Bash
 * invocation's `--body`/`--body-file`/`--fill` flags. `--body-file`/`--fill`
 * read from a file or commit messages this hook cannot see without
 * shelling out again, so those forms yield no closed-issue numbers rather
 * than guessing -- a narrower detection than the MCP-tool path, not a wrong
 * one. */
function extractClosedIssuesFromGhCommand(command) {
  const bodyFlag = /--body(?:=|\s+)(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+))/.exec(command);
  if (!bodyFlag) return [];
  const raw = bodyFlag[1] ?? bodyFlag[2] ?? bodyFlag[3] ?? '';
  return extractClosedIssueNumbers(raw);
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

/** `gh issue create`/`gh pr create` print the new item's URL to stdout
 * (e.g. `https://github.com/acme/widgets/issues/123`) -- the only place
 * its number appears, since the command's own input never carries a
 * not-yet-assigned number. Returns `null` if the output doesn't contain a
 * recognizable URL for `pathSegment` (`issues` or `pull`), never a guess. */
function extractNumberFromGhUrl(text, pathSegment) {
  const match = new RegExp(`/${pathSegment}/(\\d+)\\b`).exec(text);
  return match ? Number(match[1]) : null;
}

/** Normalize one PostToolUse hook invocation into `{ surface, action,
 * owner, repo, number, closesIssues }`, or `null` if this call touches
 * nothing this hook tracks. `owner`/`repo` fall back to the repo this hook
 * itself runs in when a tool call's own input doesn't carry them (the
 * common case for `gh` CLI calls run from a repo checkout). */
export function extractTouch(input, fallbackOwnerRepo) {
  const toolName = input?.tool_name;
  const toolInput = input?.tool_input;
  const toolOutput = input?.tool_output;

  if (toolName === 'Bash') {
    const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
    const match = GH_ISSUE_OR_PR_RE.exec(command);
    if (!match) return null;
    const [, kind, subcommand] = match;
    const owner = fallbackOwnerRepo?.owner ?? null;
    const repo = fallbackOwnerRepo?.repo ?? null;
    const outputText = extractOutputText(toolOutput);

    if (subcommand === 'create') {
      if (kind === 'pr') {
        const closesIssues = extractClosedIssuesFromGhCommand(command).map((number) => ({ owner, repo, number }));
        return { surface: 'gh-cli', action: 'create_pull_request', owner, repo, number: extractNumberFromGhUrl(outputText, 'pull'), closesIssues };
      }
      // `gh issue create`: an issue-creation touch, same action name the
      // MCP-tool path uses, so checkSubIssueLinkage/checkLifecycleComment
      // trigger identically regardless of which surface created it.
      return { surface: 'gh-cli', action: 'create_issue', owner, repo, number: extractNumberFromGhUrl(outputText, 'issues'), closesIssues: [] };
    }

    // For every other subcommand, the target number is the first bare
    // number immediately following it (`gh issue edit 42 ...`), never a
    // number found anywhere later in the command (a title/body containing
    // a digit must never be mistaken for the target number).
    const rest = command.slice(match[0].length);
    const numberMatch = /^\s*#?(\d+)\b/.exec(rest);
    const number = numberMatch ? Number(numberMatch[1]) : null;

    if (subcommand === 'edit' || subcommand === 'close') {
      return { surface: 'gh-cli', action: 'update_issue', owner, repo, number, closesIssues: [] };
    }
    // view/list/comment: not a check-triggering transition itself (a
    // comment command is what checkLifecycleComment's own transcript scan
    // looks FOR, not a subject of these checks) -- recognized as a touch
    // for scratch-file bookkeeping, but no check fires on it.
    return { surface: 'gh-cli', action: 'gh_command', owner, repo, number, closesIssues: [] };
  }

  const action = mcpAction(toolName);
  if (action === null) return null;

  const relevant =
    PR_CREATE_ACTIONS.has(action) ||
    ISSUE_CREATE_ACTIONS.has(action) ||
    STATUS_MUTATE_ACTIONS.has(action) ||
    COMMENT_ACTIONS.has(action);
  if (!relevant) return null;

  const owner = toolInput?.owner ?? fallbackOwnerRepo?.owner ?? null;
  const repo = toolInput?.repo ?? fallbackOwnerRepo?.repo ?? null;
  // A create call's own tool_input never carries the new issue/PR's number
  // (it doesn't exist yet when the call is made) -- fall back to the
  // tool's output, which returns it (create_issue: {number, ...}).
  const number =
    typeof toolInput?.number === 'number' ? toolInput.number
    : typeof toolInput?.issue_number === 'number' ? toolInput.issue_number
    : typeof toolOutput?.number === 'number' ? toolOutput.number
    : typeof toolOutput?.issue_number === 'number' ? toolOutput.issue_number
    : null;

  let closesIssues = [];
  if (PR_CREATE_ACTIONS.has(action)) {
    const bodyText = [toolInput?.body, toolOutput?.body].filter((v) => typeof v === 'string').join('\n');
    closesIssues = extractClosedIssueNumbers(bodyText).map((n) => ({ owner, repo, number: n }));
  }

  return { surface: toolName.startsWith('mcp__github__') ? 'generic-github-mcp' : 'plugin-mcp', action, owner, repo, number, closesIssues };
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
// Check 2: lifecycle-comment -- was a comment posted alongside this
// transition, anywhere earlier in this turn's transcript.
// ---------------------------------------------------------------------------

/** Best-effort: scans the JSONL transcript for an `add_issue_comment`
 * (or generic-MCP `issue_write`, or a `gh issue comment` / `gh pr comment`
 * Bash call) referencing the same owner/repo/number anywhere in the file.
 * An unreadable/missing transcript is itself a silent no-op for this check
 * specifically -- it never suppresses the other two checks (NFR-5). */
export function scanTranscriptForComment(transcriptPath, ref, readFn = readFileSync) {
  if (!transcriptPath || !ref || typeof ref.owner !== 'string' || typeof ref.repo !== 'string') {
    return { resolved: false };
  }
  let text;
  try {
    text = readFn(transcriptPath, 'utf8');
  } catch {
    return { resolved: false };
  }

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const toolName = entry?.tool_name ?? entry?.message?.tool_name;
    const toolInput = entry?.tool_input ?? entry?.message?.tool_input;
    if (!toolName || !toolInput) continue;
    const action = toolName === 'Bash' ? null : mcpAction(toolName);
    const isCommentTool = action !== null && COMMENT_ACTIONS.has(action);
    const ghCommentMatch = toolName === 'Bash' && typeof toolInput.command === 'string' ? /\bgh\s+(?:issue|pr)\s+comment\s+#?(\d+)\b/.exec(toolInput.command) : null;
    const isGhComment = ghCommentMatch !== null;
    if (!isCommentTool && !isGhComment) continue;

    const sameIssue = isGhComment
      ? Number(ghCommentMatch[1]) === ref.number
      : (toolInput.owner === ref.owner && toolInput.repo === ref.repo && (toolInput.number === ref.number || toolInput.issue_number === ref.number));
    if (sameIssue) return { resolved: true, found: true };
  }
  return { resolved: true, found: false };
}

/** WHEN a Status-mutating or issue-creating action touches a tracked issue,
 * THEN check whether a lifecycle comment accompanies it this turn.
 * Deliberately over-inclusive about which actions count as "a transition"
 * (any `set_field_value`/`update_issue`/`create_issue` call, not just a
 * Status-field change this hook cannot identify from a bare `fieldId`) --
 * an acceptable false-positive rate for an advisory nudge, not a violation
 * of the "never guess" NFR, which governs the resolved/unresolved
 * distinction, not this heuristic's precision. */
export function checkLifecycleComment(touch, transcriptPath, readFn) {
  const isTransition = touch && (STATUS_MUTATE_ACTIONS.has(touch.action) || ISSUE_CREATE_ACTIONS.has(touch.action));
  if (!isTransition || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    return { resolved: true, findings: [] };
  }
  const scan = scanTranscriptForComment(transcriptPath, touch, readFn);
  if (!scan.resolved) return { resolved: true, findings: [] }; // unreadable transcript: silent no-op for this check
  if (scan.found) return { resolved: true, findings: [] };
  return { resolved: true, findings: [`${touch.owner}/${touch.repo}#${touch.number}: transitioned with no lifecycle comment found this turn -- consider posting one.`] };
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
 * GraphQL error or a body with no recognizable MIF type marker. */
export async function checkSubIssueLinkage(touch, runGraphQL) {
  const isCreateOrUpdate = touch && (ISSUE_CREATE_ACTIONS.has(touch.action) || touch.action === 'update_issue');
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
// Assembly
// ---------------------------------------------------------------------------

/** Run all three checks independently -- one check's exception or empty
 * result never suppresses another's finding (NFR-5) -- and flatten into one
 * findings list. Each check function above already fails open internally;
 * this wrapper additionally guards against a check throwing outright, since
 * the entrypoint's own contract (never blocking, never a non-zero exit)
 * must hold even if a check has a latent bug. */
export async function runHygieneChecks(touch, { runGraphQL, transcriptPath, readFn }) {
  const findings = [];
  const results = await Promise.allSettled([
    checkStatusProgression(touch, runGraphQL),
    // Deferred via .then() rather than called inline: checkLifecycleComment
    // is synchronous, and calling it directly here would evaluate (and any
    // throw from it would propagate) while this array literal is still
    // being constructed -- before Promise.allSettled ever runs -- which
    // would reject runHygieneChecks itself and silently discard the other
    // two checks' findings too, not just this one's (NFR-5).
    Promise.resolve().then(() => checkLifecycleComment(touch, transcriptPath, readFn)),
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
