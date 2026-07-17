/**
 * ADR-0010: the pure, testable core of the bug-triage monitor -- the
 * time-driven complement to this plugin's capture-time hooks
 * (diagnostic-capture.mjs surfaces the file-bug skill the moment a failure
 * signature appears; nothing watches whether the bug that got filed ever
 * received a triage). This monitor watches the issues CREATED this session
 * (track-created-issues.mjs's scratch) and nudges when a BUG among them
 * has sat past a grace period with no Severity assigned.
 *
 * "Bug" and "triaged" follow this plugin's own conventions: a bug is an
 * issue whose native issue type is `Bug` or that carries a `bug` label;
 * triaged means the triage board's `Severity` single-select field
 * (triage-board.ts's SEVERITY_FIELD_NAME, options Critical/High/Medium/
 * Low) has a value on one of the issue's project items. Board-WIDE
 * staleness stays with the triage/milestone-triage skills -- this monitor
 * is deliberately session-scoped (ADR-0010 records the deferral).
 *
 * Known limitation, shared with the rest of the issue-side family: the
 * issue's own `projectItems` connection can omit items on a project owned
 * by a different entity than the issue's repo (issue #273). Advisory-only
 * cost: a false "untriaged" nudge; acceptable here, where set_severity's
 * own project-side scan remains the source of truth.
 *
 * Plugin-specific (NOT byte-copied): imports this plugin's own hooks/lib
 * modules freely, unlike monitor-core.mjs.
 */
import { sessionIssuesFilePath, readCreatedIssues } from '../../hooks/lib/session-issues.mjs';

/** A bug younger than this is left alone -- filing and triaging in one
 * breath is the happy path (issue-hygiene convention), so the nudge only
 * fires once the gap is real. */
export const TRIAGE_GRACE_MS = 15 * 60_000;

/** One aliased query per cycle covering every session-created issue.
 * Aliases can't be parametrized with variables, so owner/repo land inline
 * -- JSON.stringify guards the literals. Exported for tests. */
export function buildTriageQuery(refs) {
  const blocks = refs.map(
    (ref, i) => `
    i${i}: repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.repo)}) {
      issue(number: ${Number(ref.number)}) {
        state
        createdAt
        issueType { name }
        labels(first: 20) { nodes { name } }
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
    }`,
  );
  return `query {${blocks.join('')}\n}`;
}

/** This plugin's own bug convention: native `Bug` issue type, or a `bug`
 * label (case-insensitive). Exported for tests. */
export function isBugIssue(issue) {
  if (issue?.issueType?.name === 'Bug') return true;
  return (issue?.labels?.nodes ?? []).some((l) => typeof l?.name === 'string' && l.name.toLowerCase() === 'bug');
}

/** The Severity value from any of the issue's project items, or null when
 * none is set anywhere (including "not on any board at all" -- either way,
 * nobody has triaged it). Exported for tests. */
export function extractSeverity(issue) {
  for (const item of issue?.projectItems?.nodes ?? []) {
    const value = (item?.fieldValues?.nodes ?? []).find((fv) => fv?.field?.name === 'Severity');
    if (typeof value?.name === 'string') return value.name;
  }
  return null;
}

/** The triage rule, pure: an OPEN bug past the grace period with no
 * Severity draws one nudge. The key is NOT state-qualified beyond the
 * issue itself -- "still untriaged" is a persisting condition throttled by
 * monitor-core's cooldown; assigning a Severity simply ends it. Exported
 * for tests. */
export function evaluateBugFindings(issue, ref, nowMs, graceMs = TRIAGE_GRACE_MS) {
  if (!issue || issue.state !== 'OPEN' || !isBugIssue(issue)) return [];
  const createdAtMs = Date.parse(issue.createdAt ?? '');
  if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs < graceMs) return [];
  if (extractSeverity(issue) !== null) return [];
  const key = `${ref.owner}/${ref.repo}#${ref.number}`;
  const minutes = Math.round((nowMs - createdAtMs) / 60_000);
  return [
    {
      key: `bug-triage:${key}:no-severity`,
      message: `bug ${key} was filed ${minutes} min ago and still has no Severity -- next step: triage it (set_severity, or the triage skill).`,
    },
  ];
}

/** Build the monitor's assess function. No issues created this session
 * means nothing to watch -- stay silent, make zero API calls. */
export function createBugTriageAssess({
  readCreatedIssuesFn = (sessionId) => readCreatedIssues(sessionIssuesFilePath(sessionId)),
} = {}) {
  return async function assess({ sessionId, runGraphQL, nowMs }) {
    const refs = readCreatedIssuesFn(sessionId);
    if (refs.length === 0) return [];

    const data = await runGraphQL(buildTriageQuery(refs));
    const findings = [];
    refs.forEach((ref, i) => {
      findings.push(...evaluateBugFindings(data?.[`i${i}`]?.issue ?? null, ref, nowMs));
    });
    return findings;
  };
}
