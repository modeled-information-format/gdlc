/**
 * gdlc#202/#211: per-session record of PRs opened this session, so a later
 * PreToolUse hook (review-thread-gate.mjs) can check whether any of them
 * still has unresolved review threads before letting new branch/worktree
 * work start. NOT part of the ADR-0007 hygiene-check family (a different
 * concern, a different consumer, a different file) -- this module is
 * PR-lifecycle-specific and lives only in this plugin, same as
 * pr-lifecycle-gate.mjs/pr-lifecycle-config.mjs, not drift-checked against
 * github-sdlc-planning/github-bug-capture's copies. Same JSONL-scratch-file
 * shape as hygiene-scratch.mjs (session-scoped path, dependency-injected
 * fs, silent no-op on any I/O failure) deliberately NOT reused directly:
 * commingling this plugin's own opened-PR records into the hygiene
 * family's scratch stream would corrupt hygiene-aggregate.mjs's own
 * end-of-turn report, which expects every entry in that file to be a
 * touch+findings record.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRATCH_DIR_NAME = 'gdlc-session-prs';

/** Session IDs are expected to be opaque identifiers, but this sanitizes
 * defensively before using one as a filename component -- same contract as
 * hygiene-scratch.mjs's sanitizeSessionId, re-implemented here rather than
 * imported (this file's own dependency-free, single-purpose design; the
 * two never need to agree on anything beyond "produce a safe filename
 * component"). */
export function sanitizeSessionId(sessionId) {
  const value = typeof sessionId === 'string' ? sessionId : '';
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned === '' ? 'unknown-session' : cleaned;
}

export function sessionPrsFilePath(sessionId, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}.jsonl`);
}

/** Records one opened PR ref for this session. Deliberately append-only
 * and NOT deduplicated at write time -- readOpenedPrs below dedupes on
 * read, keeping this function a trivial, always-safe append matching every
 * other scratch writer in this codebase (hygiene-scratch.mjs's
 * appendScratchEntry). Any I/O failure is a silent no-op: a hook must
 * never break the tool call it observes over a scratch-file problem. */
export function recordOpenedPr(path, ref, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const append = fns.appendFileSync ?? appendFileSync;
  try {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '.';
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    append(path, `${JSON.stringify(ref)}\n`, 'utf8');
  } catch {
    // silent no-op
  }
}

/** Reads every well-formed, structurally-valid ref back, deduped by
 * `owner/repo#number`. A missing file, an unreadable file, or any
 * malformed/incomplete line is simply skipped -- this is a best-effort
 * cache, never a source of truth a caller can depend on existing. */
export function readOpenedPrs(path, fns = {}) {
  const read = fns.readFileSync ?? readFileSync;
  let text;
  try {
    text = read(path, 'utf8');
  } catch {
    return [];
  }
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry?.owner !== 'string' || typeof entry?.repo !== 'string' || typeof entry?.pullNumber !== 'number') continue;
    seen.set(`${entry.owner}/${entry.repo}#${entry.pullNumber}`, entry);
  }
  return [...seen.values()];
}
