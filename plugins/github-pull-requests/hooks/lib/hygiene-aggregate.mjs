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
 * own input envelope (which still carries none).
 *
 * gdlc#324: a re-scan of the parent's OWN transcript can never resolve a
 * lifecycle-comment finding whose comment was posted by a background
 * workflow subagent -- that comment lives only in the subagent's own
 * transcript, no matter how long the turn runs or how many times this
 * re-scan repeats. `isLifecycleFindingNowResolved` now also tries
 * `checkRecentCommentViaGraphQL` (the same live fallback
 * `checkLifecycleComment` itself uses) when the transcript re-scan alone
 * doesn't resolve it, so this aggregator no longer keeps reporting a
 * finding forever for a comment that, in reality, GitHub already has. This
 * is the one place in this file that can make a network call, and only
 * when `runGraphQL` is supplied and the transcript re-scan alone wasn't
 * enough.
 */
import { scanTranscriptForComment, checkRecentCommentViaGraphQL } from './hygiene-check.mjs';

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
 * own message text (identity + a single deterministic transcript scan,
 * plus -- gdlc#324 -- one live GraphQL fallback), unlike e.g. a
 * sub-issue-linkage finding, which would need a fresh GraphQL round trip of
 * its own this backstop deliberately never makes for that kind.
 * `scanFn` is injectable for tests, defaulting to the real transcript scan.
 *
 * gdlc#324: when the re-scan alone doesn't resolve the finding, this also
 * tries `checkRecentCommentViaGraphQL` -- the same live fallback
 * `checkLifecycleComment` itself uses -- before giving up. This is the
 * fix for a comment posted by a background subagent: that comment can
 * never appear in the PARENT transcript `scanFn` reads, no matter how many
 * times this aggregator re-scans it, so without this fallback the
 * end-of-turn reminder would report the same "gap" forever even though
 * GitHub already has the comment. `runGraphQL` is optional; when absent
 * (or the live check can't confirm anything) the finding stands, same as
 * before this fix. */
async function isLifecycleFindingNowResolved(finding, transcriptPath, scanFn, runGraphQL) {
  const match = LIFECYCLE_FINDING_RE.exec(finding);
  if (!match) return false;
  const [, owner, repo, numberStr] = match;
  const identity = { owner, repo, number: Number(numberStr) };
  const scan = scanFn(transcriptPath, identity);
  if (scan.resolved === true && scan.found === true) return true;
  return checkRecentCommentViaGraphQL(identity, runGraphQL);
}

/** Build ONE consolidated reminder from a turn's scratch entries (NFR-6):
 * a turn that touched the same or different issues five times still
 * produces a single message, not five. Entries with no findings are
 * counted but not individually quoted; only distinct findings are listed,
 * de-duplicated verbatim (the same finding can legitimately recur across
 * multiple touches of the same issue in one turn). Returns `null` when
 * there is nothing to report -- no entries, no findings at all, or every
 * finding turned out to be already resolved (gdlc#278, plus gdlc#324's live
 * GraphQL fallback) -- so the caller can stay silent rather than emit an
 * empty-handed "everything is fine" message no one asked for.
 *
 * `runGraphQL` (gdlc#324, 4th param, appended rather than folded into
 * `scanFn` as an options object to keep every existing positional call --
 * production and test alike -- working unchanged) is optional and passed
 * straight through to `isLifecycleFindingNowResolved`'s own live fallback;
 * omitting it just means that fallback never fires, the pre-#324
 * behavior. `async` since that fallback can make a network call --
 * the same kind of sync-to-async migration issue #172 already made to
 * `checkLifecycleComment` itself. */
export async function buildConsolidatedContext(entries, transcriptPath, scanFn = scanTranscriptForComment, runGraphQL) {
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

  const resolutions = await Promise.all(findings.map((finding) => isLifecycleFindingNowResolved(finding, transcriptPath, scanFn, runGraphQL)));
  const liveFindings = findings.filter((_finding, index) => !resolutions[index]);
  if (liveFindings.length === 0) return null;

  const touchCount = entries.length;
  const header = `Ticket-hygiene reminder (end of turn, ${touchCount} GitHub touch${touchCount === 1 ? '' : 'es'} this turn):`;
  return [header, ...liveFindings.map((f) => `- ${f}`)].join('\n');
}
