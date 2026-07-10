/**
 * Stop/SubagentStop end-of-turn aggregator's testable core (ADR-0007,
 * AD-3). This hook is a backstop, not a detector: it never inspects
 * `tool_name`/`tool_input` itself (Stop/SubagentStop carry only the common
 * envelope), it only summarizes what hygiene-check.mjs already wrote to
 * this session's scratch file (hygiene-scratch.mjs) during the turn.
 */

/** Build ONE consolidated reminder from a turn's scratch entries (NFR-6):
 * a turn that touched the same or different issues five times still
 * produces a single message, not five. Entries with no findings are
 * counted but not individually quoted; only distinct findings are listed,
 * de-duplicated verbatim (the same finding can legitimately recur across
 * multiple touches of the same issue in one turn). Returns `null` when
 * there is nothing to report -- no entries, or entries with no findings at
 * all -- so the caller can stay silent rather than emit an empty-handed
 * "everything is fine" message no one asked for. */
export function buildConsolidatedContext(entries) {
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

  const touchCount = entries.length;
  const header = `Ticket-hygiene reminder (end of turn, ${touchCount} GitHub touch${touchCount === 1 ? '' : 'es'} this turn):`;
  return [header, ...findings.map((f) => `- ${f}`)].join('\n');
}
