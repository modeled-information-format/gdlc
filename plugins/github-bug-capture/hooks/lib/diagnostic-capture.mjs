/**
 * Diagnostic-capture detection — the hooks-pack's testable core (issue #39).
 *
 * Deliberately plain text-signature matching over whatever text a tool
 * produced (Bash stdout/stderr, or the tail of the session transcript),
 * not exit-code inspection or a per-language test/lint/build parser: hook
 * stdin already hands over text, and the signatures below are the common,
 * language-agnostic markers a failure leaves behind. Dependency-free, same
 * spirit as hooks/lib/settings.mjs, so hooks can run it with bare `node`.
 *
 * Issue #146: the Stop-hook's file-tail scan (`detectFailureInFile`) used to
 * re-scan the same tail window on every Stop event with no memory of what it
 * had already seen, so its own previously-injected `additionalContext` —
 * which quotes the triggering excerpt verbatim, including the failure
 * signature itself (e.g. "exit code 1") — became a fresh match on the next
 * pass, compounding a layer of JSON-string-escaping each cycle. Fixed with
 * two independent measures: a per-transcript high-water-mark so only bytes
 * appended since the last scan are ever considered, and
 * `stripPriorDiagnosticBlocks` to redact any of the hook's own prior output
 * from a scan window before matching, so it can never self-trigger even in
 * the one window where it's still genuinely new content.
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Ordered so the first match wins when several signatures could apply.
 * test-failure, lint-error, and generic-error are anchored to line start
 * (allowing leading whitespace, and Go's `--- ` prefix for test-failure):
 * a real test-runner/linter marker, or a bare stderr-style "Error:" line,
 * starts its own line, whereas mid-sentence prose ("this suite does not
 * FAIL under normal conditions") does not. typescript-error and
 * nonzero-exit are deliberately NOT line-anchored, because their real
 * shape is itself mid-line ("src/index.ts(10,5): error TS2322: ...",
 * "Command failed with exit code 1"); anchoring those would miss the
 * common case entirely. generic-error is the least precise signature by
 * design even with the anchor: plain "Error:" at line start still has real
 * false-positive potential against --help-style text formatted one option
 * per line, accepted as a low-cost tradeoff since this hook only injects
 * informational context for an opt-in, default-off pack; it never files an
 * issue or mutates anything on its own. */
export const FAILURE_SIGNATURES = [
  { name: 'test-failure', pattern: /^\s*(?:---\s*)?FAIL\b/m },
  { name: 'typescript-error', pattern: /error TS\d+:/ },
  { name: 'lint-error', pattern: /^\s*\d+:\d+\s+error\s/m },
  { name: 'nonzero-exit', pattern: /exit code (?!0\b)\d+/i },
  { name: 'generic-error', pattern: /^\s*Error:\s/m },
];

const EXCERPT_RADIUS = 160;

/** Scan `text` for the first known failure signature. Returns
 * `{ detected: false }` for clean output, or `{ detected: true, signature,
 * excerpt }` with a short window of context around the match. */
export function detectFailure(text) {
  const value = String(text ?? '');
  for (const { name, pattern } of FAILURE_SIGNATURES) {
    const match = pattern.exec(value);
    if (match) {
      const start = Math.max(0, match.index - EXCERPT_RADIUS);
      const end = Math.min(value.length, match.index + EXCERPT_RADIUS);
      return { detected: true, signature: name, excerpt: value.slice(start, end).trim() };
    }
  }
  return { detected: false };
}

/** A Bash tool_output may arrive as a plain string or an object carrying
 * stdout/stderr/output fields — handle both without assuming one shape. */
export function extractOutputText(toolOutput) {
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

/** Anchor substrings bracketing a previously-injected `buildAdditionalContext`
 * block, deliberately chosen to contain no character JSON string-escaping
 * ever touches (`"`, `\`, or a control character) — only letters, spaces,
 * and (in the lead marker) an apostrophe, which JSON never escapes either.
 * A transcript records this hook's own prior output JSON-encoded (as the
 * `additionalContext` field of a transcript entry), and issue #146's
 * self-match bug compounds a fresh layer of `"`/`\` escaping around the
 * quoted excerpt on every cycle; anchoring on text that is byte-identical
 * regardless of escaping depth means detection doesn't have to know how
 * many layers deep a given block currently is. */
const DIAGNOSTIC_BLOCK_LEAD = "hooks-pack's diagnostic-capture detected a";
const DIAGNOSTIC_BLOCK_FOOTER = 'no issue has been filed';

/** Strip every previously-injected diagnostic-capture notification block out
 * of `text` before it is handed to `detectFailure`. Without this, a Stop-hook
 * scan of the session transcript re-discovers its own prior
 * `additionalContext` output — which quotes the original excerpt verbatim,
 * including whatever failure signature triggered it (e.g. "exit code 1") —
 * as a brand-new match on the next Stop event, re-injecting an ever-growing
 * notification that requoted itself every cycle (issue #146). Scans left to
 * right for the lead marker, then the next footer marker after it; if a lead
 * marker has no following footer (the block was cut off by the tail window,
 * or malformed), everything from that lead marker onward is dropped rather
 * than risking a dangling fragment that could still carry a stale signature.
 * Exported for tests. */
export function stripPriorDiagnosticBlocks(text) {
  const value = String(text ?? '');
  let result = '';
  let cursor = 0;
  for (;;) {
    const leadIndex = value.indexOf(DIAGNOSTIC_BLOCK_LEAD, cursor);
    if (leadIndex === -1) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, leadIndex);
    const footerIndex = value.indexOf(DIAGNOSTIC_BLOCK_FOOTER, leadIndex);
    if (footerIndex === -1) {
      cursor = value.length;
      break;
    }
    cursor = footerIndex + DIAGNOSTIC_BLOCK_FOOTER.length;
  }
  return result;
}

/** Read the tail of a file (a session transcript, in practice) and run the
 * same signature scan over it. Seeks and reads only the last `tailBytes`
 * bytes rather than loading the whole file, since a session transcript can
 * be arbitrarily large and only the tail is ever inspected. A multi-byte
 * UTF-8 character split at the read boundary can mangle the first
 * character or two of the tail; acceptable for a best-effort scan (same
 * "informational only" tradeoff as generic-error's precision). Missing/
 * unreadable files are a clean no-op, matching isPackEnabled's
 * fail-closed style. */
function readFileTail(path, tailBytes) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size;
    const length = Math.min(size, tailBytes);
    const position = Math.max(0, size - tailBytes);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, position);
    return { size, text: buffer.toString('utf8') };
  } catch {
    return null;
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

/** Compute the byte range to read out of a file of the given `size`,
 * given the last-scanned offset recorded from a prior invocation (`null` if
 * this is the first scan, or the recorded offset is no longer trustworthy).
 * Never re-scans bytes already scanned (`start >= lastOffset`), and never
 * scans more than `tailBytes` in one pass even when `lastOffset` is very
 * stale or absent, so a single invocation's read stays bounded regardless of
 * how large the file has grown. A `lastOffset` beyond the current file size
 * (the transcript was truncated, rotated, or replaced by a `/clear`) is
 * treated the same as "no prior offset" -- there is nothing safe to resume
 * from, so this falls back to a fresh tail window rather than reading an
 * empty or negative range. Exported for tests. */
export function computeScanWindow(size, lastOffset, tailBytes) {
  const tailStart = Math.max(0, size - tailBytes);
  if (typeof lastOffset !== 'number' || !Number.isFinite(lastOffset) || lastOffset < 0 || lastOffset > size) {
    return { start: tailStart, end: size };
  }
  return { start: Math.max(lastOffset, tailStart), end: size };
}

/** Derive a stable, filesystem-safe state-file path for a given transcript
 * path, so each transcript's scan progress is tracked independently.
 * Exported for tests. */
export function defaultStatePath(transcriptPath, stateDir = tmpdir()) {
  const key = createHash('sha256').update(String(transcriptPath)).digest('hex');
  return join(stateDir, `gdlc-diagnostic-capture-${key}.json`);
}

/** Read the last-scanned byte offset recorded for `transcriptPath`, or
 * `null` if none is recorded yet or the state file is missing/corrupt --
 * never throws, matching every other reader in this hooks layer. Exported
 * for tests. */
export function readLastOffset(transcriptPath, stateDir = tmpdir()) {
  try {
    const parsed = JSON.parse(readFileSync(defaultStatePath(transcriptPath, stateDir), 'utf8'));
    return typeof parsed?.lastOffset === 'number' ? parsed.lastOffset : null;
  } catch {
    return null;
  }
}

/** Record the byte offset scanned so far for `transcriptPath`. Best-effort:
 * a failed write is silently swallowed (the next invocation just falls back
 * to a fresh tail-window scan) rather than breaking the hook it observes.
 * Exported for tests. */
export function writeLastOffset(transcriptPath, offset, stateDir = tmpdir()) {
  try {
    writeFileSync(defaultStatePath(transcriptPath, stateDir), JSON.stringify({ lastOffset: offset }));
  } catch {
    // best-effort; see doc comment above.
  }
}

/** Read a file (a session transcript, in practice) and run the failure scan
 * only over genuinely new content since this same file's last scan (issue
 * #146's high-water-mark fix), with any of the hook's own previously-injected
 * notification blocks stripped out of that window first (issue #146's
 * self-match fix) so its own prior output can never become a new match.
 * `stateDir` is injectable for tests; production calls use the default
 * (`os.tmpdir()`), one JSON file per transcript path, keyed by its hash. */
export function detectFailureInFile(path, tailBytes = 20000, stateDir = tmpdir()) {
  const tail = readFileTail(path, tailBytes);
  if (tail === null) return { detected: false };

  const lastOffset = readLastOffset(path, stateDir);
  const window = computeScanWindow(tail.size, lastOffset, tailBytes);
  writeLastOffset(path, tail.size, stateDir);

  if (window.start >= window.end) return { detected: false };

  // `tail.text` only ever covers the last `tailBytes` of the file (from
  // `tail.size - tailBytes`, clamped to 0); translate the absolute window
  // into an index into that buffer before slicing.
  const tailStart = Math.max(0, tail.size - tailBytes);
  const sliceStart = Math.max(0, window.start - tailStart);
  const newText = tail.text.slice(sliceStart);

  return detectFailure(stripPriorDiagnosticBlocks(newText));
}

export function buildAdditionalContext(detection) {
  return [
    `The hooks-pack's diagnostic-capture detected a "${detection.signature}" signature in recent tool output:`,
    '',
    detection.excerpt,
    '',
    'If this looks like a real defect, use the file-bug skill (triage-skill-pack) to capture it as a ' +
      'structured issue with this diagnostic attached. This is informational only — no issue has been filed.',
  ].join('\n');
}
