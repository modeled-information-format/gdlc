/**
 * ADR-0010: the pure, testable core of the board-hygiene monitor -- the
 * time-driven complement to ADR-0003's set-in-progress hook and ADR-0007's
 * hygiene checks. Those fire at tool-call time; this watches the session's
 * ACTIVE issue (the one first-edit-scratch.mjs already tracks for the
 * set-in-progress flip) for drift that only shows up between events:
 *
 *   - work happening while board Status still says Todo/unset
 *     (set-in-progress failed silently, or the item was never on the board
 *     when work started and got added later);
 *   - issue CLOSED but Status never reached Done (the native Item-closed
 *     workflow failed or raced);
 *   - Status Done while the issue is still OPEN;
 *   - Status Blocked with no comment since the item last changed
 *     (a blocker with no explanation is half a status);
 *   - Status In Review with no PR actually referencing the issue;
 *   - uncommitted work sitting unchanged past a staleness threshold
 *     (the "code is committed" oversight -- a monitor runs in the session
 *     cwd, so it can watch `git status` directly, which no hook can do on
 *     a clock).
 *
 * Advisory only: nothing here mutates the board -- the one Status writer
 * remains set-in-progress.mjs. Findings carry state-qualified dedup keys
 * (monitor-core.mjs's emit-once contract): a CHANGED condition re-arms
 * immediately because the key changes; a persisting one is throttled by
 * the cooldown.
 *
 * Plugin-specific (NOT byte-copied): imports this plugin's own hooks/lib
 * modules freely, unlike monitor-core.mjs.
 */
import { execFileSync } from 'node:child_process';
import { activeIssuePath, readActiveIssue, issueKey } from '../../hooks/lib/first-edit-scratch.mjs';
import { readBoardConfig } from '../../hooks/lib/in-progress.mjs';

/** Uncommitted work older than this (unchanged) draws a commit nudge. */
export const GIT_STALENESS_MS = 30 * 60_000;

/** One aliased query per cycle: issue state, its project items (matched to
 * the configured board by project number + owner login, avoiding a second
 * project-id round trip), the PRs GitHub itself links as closing this
 * issue, and the latest comment for the Blocked check. */
export const ISSUE_HYGIENE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        state
        projectItems(first: 100) {
          nodes {
            updatedAt
            project {
              number
              owner {
                ... on Organization { login }
                ... on User { login }
              }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
        closedByPullRequestsReferences(first: 10) {
          nodes { state }
        }
        comments(last: 1) {
          nodes { createdAt }
        }
      }
    }
  }
`;

/** Find this issue's item on the configured board and its Status, matched
 * by project number + owner login. Returns `null` when the issue is not on
 * that board. Exported for tests. */
export function extractBoardItem(data, config) {
  const nodes = data?.repository?.issue?.projectItems?.nodes ?? [];
  const item = nodes.find(
    (n) => n?.project?.number === config.projectNumber && n?.project?.owner?.login === config.projectOwnerLogin,
  );
  if (!item) return null;
  const statusValue = (item.fieldValues?.nodes ?? []).find((fv) => fv?.field?.name === 'Status');
  return { status: statusValue?.name ?? null, itemUpdatedAt: item.updatedAt ?? null };
}

/** The board-drift rules, one place, pure. `data` is ISSUE_HYGIENE_QUERY's
 * response for `ref`; returns `{ key, message }` findings. Exported for
 * tests. */
export function evaluateBoardFindings(data, ref, config) {
  const issue = data?.repository?.issue;
  if (!issue) return [];
  const findings = [];
  const key = issueKey(ref);
  const item = extractBoardItem(data, config);
  const status = item?.status ?? null;
  const issueState = issue.state;

  if (issueState === 'OPEN' && item !== null && (status === null || status === 'Todo')) {
    findings.push({
      key: `board-hygiene:${key}:todo:${status ?? 'unset'}`,
      message: `${key} is being worked in this session but board Status is still "${status ?? 'unset'}" -- next step: set Status to In Progress.`,
    });
  }

  if (issueState === 'CLOSED' && item !== null && status !== 'Done') {
    findings.push({
      key: `board-hygiene:${key}:closed-not-done:${status ?? 'unset'}`,
      message: `${key} is closed but board Status is "${status ?? 'unset'}" -- next step: set Status to Done (or reopen it if the work is unfinished).`,
    });
  }

  if (issueState === 'OPEN' && status === 'Done') {
    findings.push({
      key: `board-hygiene:${key}:done-but-open`,
      message: `${key} has board Status Done but the issue is still open -- next step: close the issue or correct its Status.`,
    });
  }

  if (status === 'Blocked') {
    const lastComment = issue.comments?.nodes?.[0]?.createdAt ?? null;
    const itemUpdatedAt = item?.itemUpdatedAt ?? null;
    // Proxy: the item's own updatedAt moves when Status flips to Blocked;
    // a last comment older than that (or none at all) means nobody said
    // why. Coarse but advisory -- a false nudge costs one line.
    if (itemUpdatedAt !== null && (lastComment === null || lastComment < itemUpdatedAt)) {
      findings.push({
        key: `board-hygiene:${key}:blocked-no-comment:${itemUpdatedAt}`,
        message: `${key} is Blocked with no comment since the status change -- next step: post a comment explaining the blocker.`,
      });
    }
  }

  if (issueState === 'OPEN' && status === 'In Review') {
    const prs = issue.closedByPullRequestsReferences?.nodes ?? [];
    const hasLivePr = prs.some((pr) => pr?.state === 'OPEN' || pr?.state === 'MERGED');
    if (!hasLivePr) {
      findings.push({
        key: `board-hygiene:${key}:in-review-no-pr`,
        message: `${key} has board Status In Review but no open PR references it -- next step: open the PR or move Status back to In Progress.`,
      });
    }
  }

  return findings;
}

/** The "code is committed" oversight. `tracker` is closure state owned by
 * the long-lived monitor process ({ signature, dirtySinceMs }); a change
 * in the porcelain output resets the clock, a clean tree clears it, and
 * only a signature unchanged past `stalenessMs` yields a finding. The key
 * embeds dirtySinceMs, so ANOTHER 30 minutes of the same untouched dirt
 * re-nudges only via the cooldown, while new edits re-arm a fresh clock.
 * Exported for tests. */
export function evaluateGitStaleness(porcelain, tracker, nowMs, ref, stalenessMs = GIT_STALENESS_MS) {
  const signature = String(porcelain ?? '').trim();
  if (signature === '') {
    tracker.signature = null;
    tracker.dirtySinceMs = null;
    return null;
  }
  if (tracker.signature !== signature) {
    tracker.signature = signature;
    tracker.dirtySinceMs = nowMs;
    return null;
  }
  if (nowMs - tracker.dirtySinceMs < stalenessMs) return null;
  const minutes = Math.round((nowMs - tracker.dirtySinceMs) / 60_000);
  const anchor = ref ? ` while ${issueKey(ref)} is in progress` : '';
  return {
    key: `board-hygiene:git-dirty:${tracker.dirtySinceMs}`,
    message: `uncommitted changes have sat unchanged for ${minutes} min${anchor} -- next step: commit or stash the work in progress.`,
  };
}

function defaultRunGit(cwd) {
  return execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/** Build the monitor's assess function. All I/O is injectable; the
 * returned closure owns the git-staleness tracker for the process
 * lifetime. No active issue recorded for this session/cwd means nothing
 * to watch -- the monitor stays silent rather than guessing. */
export function createBoardHygieneAssess({
  readActiveIssueFn = (sessionId, cwd) => readActiveIssue(activeIssuePath(sessionId, cwd)),
  readBoardConfigFn = readBoardConfig,
  runGitFn = defaultRunGit,
} = {}) {
  const gitTracker = { signature: null, dirtySinceMs: null };

  return async function assess({ sessionId, cwd, runGraphQL, nowMs }) {
    const ref = readActiveIssueFn(sessionId, cwd);
    if (!ref) return [];

    const findings = [];

    // Git staleness never depends on the board being configured or the
    // API being reachable -- run it first, and never let a git failure
    // (not a repo, git missing) kill the board checks.
    try {
      const staleness = evaluateGitStaleness(runGitFn(cwd), gitTracker, nowMs, ref);
      if (staleness) findings.push(staleness);
    } catch {
      // not a git repo / git unavailable: simply no staleness signal
    }

    const config = readBoardConfigFn(cwd);
    if (config) {
      const data = await runGraphQL(ISSUE_HYGIENE_QUERY, { owner: ref.owner, repo: ref.repo, number: ref.number });
      findings.push(...evaluateBoardFindings(data, ref, config));
    }

    return findings;
  };
}
