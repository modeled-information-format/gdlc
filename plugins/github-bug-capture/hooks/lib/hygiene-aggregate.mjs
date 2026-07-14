/**
 * Stop/SubagentStop end-of-turn aggregator's testable core (ADR-0007,
 * AD-3). This hook is a backstop, not a detector: Stop/SubagentStop's OWN
 * input envelope carries no `tool_name`/`tool_input` (unlike PostToolUse,
 * which hygiene-check.mjs handles), so it can't identify a touch itself --
 * it only summarizes what hygiene-check.mjs already wrote to this
 * session's scratch file (hygiene-scratch.mjs) during the turn.
 *
 * gdlc#278: for the one finding kind cheap and unambiguous enough to
 * revalidate this way (see isLifecycleFindingNowResolved below), it also
 * re-runs hygiene-check.mjs's own `scanTranscriptForComment` against the
 * turn's transcript file -- reading that file's logged `tool_name`/
 * `tool_input` history is how that scan works, distinct from this hook's
 * own input envelope (which still carries none). No network call is
 * involved either way.
 */
import { scanTranscriptForComment } from './hygiene-check.mjs';

/** Matches exactly the string `checkLifecycleComment` (hygiene-check.mjs)
 * emits, recovering the `owner`/`repo`/`number` identity it already embeds
 * in the finding text -- the scratch entry itself doesn't carry those for
 * a `set_field_value` touch (see checkLifecycleComment's own doc comment),
 * so the finding string is the only place this identity survives the
 * PostToolUse-to-Stop process boundary. */
const LIFECYCLE_FINDING_RE = /^([^/\s]+)\/([^#\s]+)#(\d+): transitioned with no lifecycle comment found this turn/;

/** gdlc#278: a lifecycle-comment finding recorded at PostToolUse time can
 * have been resolved since -- by a later touch in the SAME turn posting
 * the comment `checkLifecycleComment` found missing at that instant. Each
 * scratch entry only reflects the transcript as it stood when its own
 * PostToolUse call ran, so replaying every entry's findings verbatim (the
 * only thing this function used to do) reports a gap that's already
 * closed. Re-runs the identical transcript scan (`scanTranscriptForComment`,
 * the same check `checkLifecycleComment` itself calls) against the turn's
 * FINAL transcript state, and drops any lifecycle-comment finding that
 * scan now resolves as found -- the live end-of-turn truth wins over the
 * stale scratch-time snapshot. Only this one finding *kind* is re-checked:
 * it's the one cheap and unambiguous enough to revalidate purely from its
 * own message text (identity + a single deterministic, network-free
 * transcript scan), unlike e.g. a sub-issue-linkage finding, which would
 * need a fresh GraphQL round trip this backstop deliberately never makes.
 * `scanFn` is injectable for tests, defaulting to the real transcript scan. */
function isLifecycleFindingNowResolved(finding, transcriptPath, scanFn) {
  const match = LIFECYCLE_FINDING_RE.exec(finding);
  if (!match) return false;
  const [, owner, repo, numberStr] = match;
  const scan = scanFn(transcriptPath, { owner, repo, number: Number(numberStr) });
  return scan.resolved === true && scan.found === true;
}

/** Build ONE consolidated reminder from a turn's scratch entries (NFR-6):
 * a turn that touched the same or different issues five times still
 * produces a single message, not five. Entries with no findings are
 * counted but not individually quoted; only distinct findings are listed,
 * de-duplicated verbatim (the same finding can legitimately recur across
 * multiple touches of the same issue in one turn). Returns `null` when
 * there is nothing to report -- no entries, no findings at all, or every
 * finding turned out to be already resolved (gdlc#278) -- so the caller
 * can stay silent rather than emit an empty-handed "everything is fine"
 * message no one asked for. */
export function buildConsolidatedContext(entries, transcriptPath, scanFn = scanTranscriptForComment) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const findings = [];
  const seen = new Set();
  for (const entry of entries) {
    // entry.findings crosses a process boundary via the scratch file
    // (hygiene-scratch.mjs); a malformed or version-skewed entry (a
    // non-array findings field) must be skipped, never thrown on -- this
    // aggregator is a backstop, and a backstop that itself crashes is
    // worse than one that silently ignores one bad entry.
    const entryFindings = entry?.findings;
    if (!Array.isArray(entryFindings)) continue;
    for (const finding of entryFindings) {
      if (typeof finding !== 'string' || seen.has(finding)) continue;
      seen.add(finding);
      findings.push(finding);
    }
  }
  if (findings.length === 0) return null;

  const liveFindings = findings.filter((finding) => !isLifecycleFindingNowResolved(finding, transcriptPath, scanFn));
  if (liveFindings.length === 0) return null;

  const touchCount = entries.length;
  const header = `Ticket-hygiene reminder (end of turn, ${touchCount} GitHub touch${touchCount === 1 ? '' : 'es'} this turn):`;
  return [header, ...liveFindings.map((f) => `- ${f}`)].join('\n');
}
