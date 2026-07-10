/**
 * Per-session scratch file shared between hygiene-check.mjs (PostToolUse,
 * writer) and hygiene-aggregate.mjs (Stop/SubagentStop, reader) -- part of
 * ADR-0007's Stop/SubagentStop end-of-turn aggregator (AD-3). Neither
 * turn-boundary event carries per-call `tool_name`/`tool_input`, so the
 * aggregator has nothing to detect on its own; this file is the only
 * channel it has into what PostToolUse already saw this turn.
 *
 * Every function here is dependency-injected for the actual filesystem
 * call (same shape as hooks/lib/in-progress.mjs's `runGraphQL` injection),
 * so tests never touch the real filesystem. All I/O failures are silent
 * no-ops by design -- a hook must never break the tool call it observes,
 * and a scratch-file problem is never more important than that.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const SCRATCH_DIR_NAME = 'gdlc-hygiene-scratch';

/** Session IDs are expected to be opaque identifiers, but this sanitizes
 * defensively before using one as a filename component -- never trust
 * external input as a path segment, even hook-supplied input. */
export function sanitizeSessionId(sessionId) {
  const value = typeof sessionId === 'string' ? sessionId : '';
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned === '' ? 'unknown-session' : cleaned;
}

export function scratchFilePath(sessionId, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}.jsonl`);
}

/** Append one touch record (touch + findings) to this session's scratch
 * file, creating the containing directory on first use. Any failure
 * (permissions, disk full, unwritable tmp) is swallowed -- the calling
 * hook's own exit-0/no-block contract must never depend on this
 * succeeding. */
export function appendScratchEntry(path, entry, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const append = fns.appendFileSync ?? appendFileSync;
  try {
    const dir = dirname(path);
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    append(path, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // silent no-op: a scratch-write failure must never surface to the caller
  }
}

/** Parse every well-formed JSON line in the scratch file; a missing file,
 * an unreadable file, or any malformed line is simply skipped rather than
 * thrown -- the aggregator degrades to "nothing to report" in every such
 * case. */
export function readScratchEntries(path, fns = {}) {
  const read = fns.readFileSync ?? readFileSync;
  let text;
  try {
    text = read(path, 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip a malformed line rather than aborting the whole read
    }
  }
  return entries;
}

/** Best-effort cleanup after the aggregator has consumed a session's
 * scratch file, so a later turn in the same session starts fresh. Missing
 * file or a permission error is a silent no-op -- a stale scratch file
 * merely risks re-reporting an already-surfaced finding once, never a
 * blocking failure. */
export function clearScratch(path, fns = {}) {
  const unlink = fns.unlinkSync ?? unlinkSync;
  try {
    unlink(path);
  } catch {
    // silent no-op
  }
}
