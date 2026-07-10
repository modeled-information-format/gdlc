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
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRATCH_DIR_NAME = 'gdlc-first-edit';

export function sanitizeSessionId(sessionId) {
  const value = typeof sessionId === 'string' ? sessionId : '';
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned === '' ? 'unknown-session' : cleaned;
}

export function activeIssuePath(sessionId, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}-active.json`);
}

export function promotedPath(sessionId, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}-promoted.json`);
}

function writeJson(path, data, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const write = fns.writeFileSync ?? writeFileSync;
  try {
    const dir = path.slice(0, Math.max(path.lastIndexOf('/'), 0)) || '.';
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
