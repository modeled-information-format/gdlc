/**
 * gdlc#204/#214: session-scoped state for set-in-progress.mjs's
 * Write/Edit/MultiEdit extension. Neither of those tools' tool_input
 * carries any GitHub issue reference (just a file path) -- there is no
 * way to know "which issue is this edit for" from the tool call alone.
 * This module bridges that gap:
 *
 *   - writeActiveIssue/readActiveIssue: the most recent
 *     owner/repo/number this session's add_sub_issue/update_issue calls
 *     referenced -- "what issue is currently being worked on," updated on
 *     every one of those calls, read back the moment a Write/Edit/
 *     MultiEdit fires with no issue reference of its own.
 *   - readPromotedSet/markPromoted: which owner/repo#number this session
 *     has ALREADY checked-or-flipped via the first-edit path, so the
 *     second, third, ... edit against the same item skips the GraphQL
 *     round trip entirely instead of re-querying an already-settled
 *     item's Status on every single edit (the "gated to fire once per
 *     item per session" requirement -- a correctness gate against
 *     hook-spam/API overhead, not merely against a duplicate write,
 *     since isEligibleStatus already prevents a duplicate WRITE on its
 *     own).
 *
 * Same dependency-injected-fs, silent-no-op-on-failure shape as every
 * other scratch module in this codebase (hygiene-scratch.mjs,
 * session-prs.mjs) -- a hook must never break the tool call it observes
 * over a scratch-file problem.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// Code-review finding: this module previously re-implemented
// sanitizeSessionId verbatim even though hygiene-scratch.mjs, in this same
// lib/ directory, already exports it -- a pure, side-effect-free sanitizer
// with no dependency on the hygiene family's own scratch-stream format, so
// there's no reason (unlike the storage/data itself, which deliberately
// stays separate -- see the top-of-file doc comment) not to share it.
// Imported (not just re-exported) since activeIssuePath/promotedPath below
// call it directly; re-exported too so existing callers of this module
// keep working unchanged.
import { sanitizeSessionId } from './hygiene-scratch.mjs';

export { sanitizeSessionId };

const SCRATCH_DIR_NAME = 'gdlc-first-edit';

/** Code-review finding: scoping the active-issue/promoted state by
 * session_id ALONE let one incidental update_issue call against an
 * unrelated issue (or a second worktree active under the same session_id
 * -- this workspace's own convention is one worktree per branch, several
 * running in parallel) silently hijack "what's being worked on" for every
 * other worktree sharing that session. Hashing `cwd` into the scratch
 * filename gives each worktree its own active-issue slot, so an unrelated
 * touch in worktree B can no longer overwrite what worktree A's next edit
 * will read back. This does not fully solve an unrelated update_issue call
 * made FROM THE SAME worktree (a genuinely harder problem -- nothing in a
 * Write/Edit/MultiEdit call or a prior update_issue call distinguishes
 * "housekeeping on a different issue" from "the issue I'm about to edit
 * for"), which remains a known, accepted residual limitation, not a claim
 * of full correctness. */
function scopeSuffix(cwd) {
  const value = typeof cwd === 'string' && cwd !== '' ? cwd : 'unknown-cwd';
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function activeIssuePath(sessionId, cwd, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}-${scopeSuffix(cwd)}-active.json`);
}

export function promotedPath(sessionId, cwd, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}-${scopeSuffix(cwd)}-promoted.json`);
}

function writeJson(path, data, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const write = fns.writeFileSync ?? writeFileSync;
  try {
    const dir = dirname(path);
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    write(path, JSON.stringify(data), 'utf8');
  } catch {
    // silent no-op: a scratch-write failure must never surface to the caller
  }
}

function readJson(path, fns = {}) {
  const read = fns.readFileSync ?? readFileSync;
  try {
    return JSON.parse(read(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Overwrites (not appends) -- only the MOST RECENT active issue matters
 * for the first-edit lookup; there is no value in keeping a history here. */
export function writeActiveIssue(path, ref, fns = {}) {
  writeJson(path, ref, fns);
}

/** Returns `null` if never written, unreadable, or structurally invalid --
 * a Write/Edit/MultiEdit touch with no resolvable active issue is simply a
 * silent no-op for this feature, never a guess at which issue it might be. */
export function readActiveIssue(path, fns = {}) {
  const value = readJson(path, fns);
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof value.owner !== 'string' ||
    typeof value.repo !== 'string' ||
    typeof value.number !== 'number'
  ) {
    return null;
  }
  return { owner: value.owner, repo: value.repo, number: value.number };
}

export function issueKey(ref) {
  return `${ref.owner}/${ref.repo}#${ref.number}`;
}

export function readPromotedSet(path, fns = {}) {
  const value = readJson(path, fns);
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
}

/** Read-modify-write, not append-only: the promoted set is small (bounded
 * by distinct issues touched in one session) and needs de-duplication on
 * write, unlike the append-only JSONL scratch files elsewhere in this
 * codebase. */
export function markPromoted(path, key, fns = {}) {
  const existing = readPromotedSet(path, fns);
  if (existing.includes(key)) return;
  writeJson(path, [...existing, key], fns);
}
