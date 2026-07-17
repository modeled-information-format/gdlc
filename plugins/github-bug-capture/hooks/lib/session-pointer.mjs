/**
 * ADR-0010 (docs/decisions/adr-0010-session-monitors.md): cwd-keyed pointer
 * from "the directory a session is running in" to "that session's
 * session_id", written by hooks (which receive session_id on stdin) and
 * read by this plugin's background monitors (which start with no session
 * context at all -- a monitor process only knows its own cwd). Every other
 * scratch module in this codebase keys by session_id, so without this
 * bridge a monitor has no way to find the hook-written state it is meant
 * to watch.
 *
 * One JSON file per cwd (`tmpdir()/gdlc-session-pointer/<sha256(cwd)[0:12]>
 * .json`), overwritten -- only the MOST RECENT session in a directory
 * matters, same single-slot reasoning as first-edit-scratch.mjs's
 * active-issue file. Concurrent sessions sharing one cwd therefore
 * last-writer-wins: the monitor converges on the most recently active
 * session's state, and the worst case is an advisory nudge about a sibling
 * session's issue/PR -- an accepted residual for a non-blocking shepherd,
 * documented in ADR-0010, not a claim of full correctness.
 *
 * Byte-identical copies of this file (and the hooks/session-pointer.mjs
 * entrypoint) ship in every monitor-bearing plugin, kept in sync by the
 * same CI drift check as the ADR-0007 hygiene family. All three copies
 * deliberately write into the SAME directory and filename for a given cwd
 * -- unlike hygiene-scratch.mjs's INSTANCE_NAMESPACE, which keeps sibling
 * copies' data apart, a pointer is idempotent shared state (every copy
 * writes the same sessionId/cwd for the same session), so converging on
 * one file is the point, not a collision.
 *
 * Same dependency-injected-fs, silent-no-op-on-failure shape as every
 * other scratch module here (hygiene-scratch.mjs, first-edit-scratch.mjs,
 * session-prs.mjs) -- a hook must never break the tool call it observes,
 * and a monitor must never die, over a scratch-file problem.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';

const POINTER_DIR_NAME = 'gdlc-session-pointer';

/** A pointer older than this is ignored entirely -- generously past any
 * plausible session length, so a live session is never orphaned, while a
 * days-old leftover from a crashed host can't be mistaken for one. */
export const POINTER_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Same 12-hex-char cwd digest as first-edit-scratch.mjs's scopeSuffix --
 * short, stable, and filename-safe regardless of what characters the real
 * path contains. */
function cwdSuffix(cwd) {
  const value = typeof cwd === 'string' && cwd !== '' ? cwd : 'unknown-cwd';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function pointerDirPath(baseDir = tmpdir()) {
  return join(baseDir, POINTER_DIR_NAME);
}

export function pointerFilePath(cwd, baseDir = tmpdir()) {
  return join(pointerDirPath(baseDir), `${cwdSuffix(cwd)}.json`);
}

/** Overwrites (not appends): only the most recent session in this cwd
 * matters. Any I/O failure is a silent no-op. */
export function writeSessionPointer(path, pointer, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const write = fns.writeFileSync ?? writeFileSync;
  try {
    const dir = dirname(path);
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    write(path, JSON.stringify(pointer), 'utf8');
  } catch {
    // silent no-op: a pointer-write failure must never surface to the caller
  }
}

/** Returns `null` if never written, unreadable, or structurally invalid --
 * a monitor with no resolvable pointer simply idles until one appears,
 * never guesses at a session. */
export function readSessionPointer(path, fns = {}) {
  const read = fns.readFileSync ?? readFileSync;
  let value;
  try {
    value = JSON.parse(read(path, 'utf8'));
  } catch {
    return null;
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.sessionId !== 'string' ||
    value.sessionId === '' ||
    typeof value.cwd !== 'string' ||
    typeof value.updatedAt !== 'number'
  ) {
    return null;
  }
  return { sessionId: value.sessionId, cwd: value.cwd, updatedAt: value.updatedAt };
}

/** True when one path is the other or a descendant of the other, in either
 * direction -- the relationship a session's launch directory and a
 * hook-reported cwd can have once EnterWorktree/`cd` moves the session
 * around. A worktree that is a SIBLING of the monitor's cwd (this
 * workspace's own `worktrees/` convention, when the session was launched
 * inside one repo) shares no prefix and is NOT matched -- an accepted
 * residual: the SessionStart pointer written at the launch directory still
 * resolves that session, since sessionId never changes mid-session. */
function pathsRelated(a, b) {
  if (a === b) return true;
  return a.startsWith(b + sep) || b.startsWith(a + sep);
}

/** Resolve which session this monitor should watch, from its own cwd:
 * the exact cwd-keyed pointer if fresh, else the freshest pointer in the
 * directory whose recorded cwd is prefix-related to `cwd`, else `null`.
 * Called every poll cycle (never cached) so a new session in the same
 * directory is picked up without a monitor restart. Pure given the
 * injected fs/clock; any I/O failure resolves to `null`. */
export function resolveSessionPointer(cwd, { baseDir = tmpdir(), nowMs = Date.now(), fns = {} } = {}) {
  const fresh = (p) => p !== null && nowMs - p.updatedAt <= POINTER_MAX_AGE_MS;

  const exact = readSessionPointer(pointerFilePath(cwd, baseDir), fns);
  if (fresh(exact)) return exact;

  const readdir = fns.readdirSync ?? readdirSync;
  let entries;
  try {
    entries = readdir(pointerDirPath(baseDir));
  } catch {
    return null;
  }
  let best = null;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const pointer = readSessionPointer(join(pointerDirPath(baseDir), entry), fns);
    if (!fresh(pointer) || !pathsRelated(pointer.cwd, cwd)) continue;
    if (best === null || pointer.updatedAt > best.updatedAt) best = pointer;
  }
  return best;
}
