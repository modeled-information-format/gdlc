/**
 * ADR-0010: per-session record of issues CREATED this session, the data
 * source for this plugin's bug-triage background monitor. The hygiene
 * family's own scratch (hygiene-scratch.mjs) deliberately clears at every
 * turn boundary -- hygiene-aggregate.mjs consumes and wipes it so a later
 * turn starts fresh -- which makes it unusable as a session-long memory;
 * this module is the persistent equivalent, modeled line-for-line on
 * github-pull-requests' session-prs.mjs (same JSONL shape, same
 * dependency-injected fs, same silent no-op on any I/O failure, same
 * dedupe-on-read). Plugin-specific: NOT part of any drift-checked family.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// Same shared-sanitizer reasoning as session-prs.mjs: hygiene-scratch.mjs
// (this plugin's own byte-copy) already exports a pure, side-effect-free
// sanitizer; re-implementing it verbatim would just be drift waiting to
// happen.
import { sanitizeSessionId } from './hygiene-scratch.mjs';

export { sanitizeSessionId };

const SCRATCH_DIR_NAME = 'gdlc-session-issues';

export function sessionIssuesFilePath(sessionId, baseDir = tmpdir()) {
  return join(baseDir, SCRATCH_DIR_NAME, `${sanitizeSessionId(sessionId)}.jsonl`);
}

/** Append-only, deduped on read -- see session-prs.mjs's recordOpenedPr
 * for why the write side stays a trivial always-safe append. */
export function recordCreatedIssue(path, ref, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const append = fns.appendFileSync ?? appendFileSync;
  try {
    const dir = dirname(path);
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    append(path, `${JSON.stringify(ref)}\n`, 'utf8');
  } catch {
    // silent no-op
  }
}

/** Every well-formed ref, deduped by `owner/repo#number`. Best-effort
 * cache, never a source of truth. */
export function readCreatedIssues(path, fns = {}) {
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
    if (typeof entry?.owner !== 'string' || typeof entry?.repo !== 'string' || typeof entry?.number !== 'number') continue;
    seen.set(`${entry.owner}/${entry.repo}#${entry.number}`, entry);
  }
  return [...seen.values()];
}
