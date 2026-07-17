/**
 * ADR-0010: the pure, testable core of the pr-settlement monitor -- the
 * time-driven complement to this plugin's event-driven PR-lifecycle hooks
 * (ADR-0002; pr-lifecycle-gate.mjs, review-thread-gate.mjs). Those fire
 * when a tool call happens; this watches the PRs opened THIS SESSION
 * (track-opened-prs.mjs's scratch, gdlc#202/#211) for settlement drift
 * that surfaces on a clock, not an event:
 *
 *   - checks FAILING on the current head while the model has moved on;
 *   - a review landed (CHANGES_REQUESTED) or unresolved thread count rose
 *     since the last look -- review-thread-gate.mjs only fires when new
 *     branch work STARTS, so a review arriving mid-flight is exactly the
 *     gap a monitor closes;
 *   - everything green, approved, zero unresolved threads -> the PR is
 *     settled and the next step is to merge it (the shepherd-forward case);
 *   - merged -> one-time reminder to verify linked issues closed and the
 *     board shows Done (time-based backstop to the hygiene family's
 *     closing-keyword checks).
 *
 * Advisory only, never mutates. Findings carry state-qualified dedup keys
 * (head sha / thread count), so a push or a new thread re-arms immediately
 * while a persisting condition is throttled by monitor-core's cooldown.
 *
 * Plugin-specific (NOT byte-copied): imports this plugin's own hooks/lib
 * modules freely, unlike monitor-core.mjs.
 */
import { sessionPrsFilePath, readOpenedPrs } from '../../hooks/lib/session-prs.mjs';

/** Build ONE aliased query covering every session PR. Aliases can't be
 * parametrized with GraphQL variables, so owner/repo land inline --
 * JSON.stringify guards the string literals. Bounded by the number of PRs
 * one session opens (small); reviewThreads capped at 100, which is an
 * accepted advisory bound, not pagination. Exported for tests. */
export function buildSettlementQuery(refs) {
  const blocks = refs.map(
    (ref, i) => `
    p${i}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
      pullRequest(number: ${Number(ref.pullNumber)}) {
        state
        merged
        isDraft
        headRefOid
        reviewDecision
        commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
        reviewThreads(first: 100) { nodes { isResolved } }
      }
    }`,
  );
  return `query {${blocks.join('')}\n}`;
}

function prKey(ref) {
  return `${ref.owner}/${ref.repo}#${ref.pullNumber}`;
}

/** The settlement rules for one PR, pure. `pr` is the aliased query's
 * pullRequest node (possibly null if the PR vanished). Exported for
 * tests. */
export function evaluatePrFindings(pr, ref) {
  if (!pr) return [];
  const key = prKey(ref);
  const head = typeof pr.headRefOid === 'string' ? pr.headRefOid.slice(0, 12) : 'unknown';

  if (pr.merged === true) {
    return [
      {
        key: `pr-settlement:${key}:merged`,
        message: `${key} is merged -- next step: verify its linked issues are closed and their board Status reads Done.`,
      },
    ];
  }
  if (pr.state !== 'OPEN') return []; // closed-unmerged: nothing to shepherd

  const findings = [];
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const unresolved = (pr.reviewThreads?.nodes ?? []).filter((t) => t && t.isResolved === false).length;

  if (rollup === 'FAILURE' || rollup === 'ERROR') {
    findings.push({
      key: `pr-settlement:${key}:ci-failed:${head}`,
      message: `${key} has failing checks on its current head -- next step: fix or re-run them.`,
    });
  }

  // Draft PRs get the CI signal above (a red draft is still worth fixing)
  // but none of the review/merge shepherding below.
  if (pr.isDraft === true) return findings;

  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    findings.push({
      key: `pr-settlement:${key}:changes-requested:${head}`,
      message: `${key} has a CHANGES_REQUESTED review -- next step: address the findings, push, and re-request review.`,
    });
  }

  if (unresolved > 0) {
    // The count is part of the key: a RISING count is a new condition and
    // re-arms immediately; the same count persisting is cooldown-throttled.
    findings.push({
      key: `pr-settlement:${key}:threads:${unresolved}:${head}`,
      message: `${key} has ${unresolved} unresolved review thread${unresolved === 1 ? '' : 's'} -- next step: address and resolve every one.`,
    });
  }

  if (rollup === 'SUCCESS' && unresolved === 0 && pr.reviewDecision === 'APPROVED') {
    findings.push({
      key: `pr-settlement:${key}:settled:${head}`,
      message: `${key} is settled (checks green, approved, zero unresolved threads) -- next step: merge it.`,
    });
  }

  return findings;
}

/** Build the monitor's assess function. No PRs recorded for this session
 * means nothing to watch -- stay silent, make zero API calls. */
export function createPrSettlementAssess({
  readOpenedPrsFn = (sessionId) => readOpenedPrs(sessionPrsFilePath(sessionId)),
} = {}) {
  return async function assess({ sessionId, runGraphQL }) {
    const refs = readOpenedPrsFn(sessionId);
    if (refs.length === 0) return [];

    const data = await runGraphQL(buildSettlementQuery(refs));
    const findings = [];
    refs.forEach((ref, i) => {
      findings.push(...evaluatePrFindings(data?.[`p${i}`]?.pullRequest ?? null, ref));
    });
    return findings;
  };
}
