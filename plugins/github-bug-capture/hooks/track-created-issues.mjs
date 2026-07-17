#!/usr/bin/env node
// ADR-0010: PostToolUse hook that records every issue CREATED this session
// to a session-scoped scratch file (session-issues.mjs), the data source
// for this plugin's bug-triage background monitor. Mirrors
// github-pull-requests' track-opened-prs.mjs: reuses extractTouch from
// this plugin's own copy of the hygiene lib (which already detects
// create_issue on the gh CLI, generic github MCP, and plugin-MCP surfaces,
// including github-sdlc-planning's create_issue tool -- this hook's
// matchers deliberately cover that cross-plugin tool name, since that is
// how issues are normally created where these plugins are installed
// together). Gated on the monitors pack alone: this scratch exists only
// for the monitor, so tracking without it would be pointless overhead.
// Plugin-specific: NOT part of any drift-checked family.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extractTouch } from './lib/hygiene-check.mjs';
import { sessionIssuesFilePath, recordCreatedIssue } from './lib/session-issues.mjs';
import { pointerFilePath, writeSessionPointer } from './lib/session-pointer.mjs';
import { isMonitorsPackEnabled } from '../monitors/lib/monitor-core.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function emitEmpty() {
  process.stdout.write(JSON.stringify({}));
}

/** Same cwd-derived fallback as track-opened-prs.mjs, duplicated for the
 * same reason it documents: this file is not part of the drift-checked
 * hygiene family, so it cannot import the family entrypoint's helper. */
function fallbackOwnerRepoFromCwd(cwd) {
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = /[:/]([^/:]+)\/([^/.]+?)(?:\.git)?$/.exec(url);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();

  // ADR-0010: refresh the cwd -> session_id pointer the background
  // monitors resolve their session from, BEFORE any gating below -- this
  // plugin's other PostToolUse hooks are either pack-gated or part of the
  // byte-copied hygiene family, so this hook doubles as its mid-session
  // heartbeat alongside the SessionStart entrypoint (session-pointer.mjs).
  if (typeof input.session_id === 'string' && input.session_id !== '') {
    writeSessionPointer(pointerFilePath(cwd), { sessionId: input.session_id, cwd, updatedAt: Date.now() });
  }

  if (!isMonitorsPackEnabled(cwd) || !input.session_id) {
    emitEmpty();
    return;
  }

  // Same cheap-regex-before-shell-out gating as track-opened-prs.mjs.
  let fallbackOwnerRepo = null;
  if (input.tool_name === 'Bash' && /^\s*gh\s+issue\s+create\b/.test(String(input.tool_input?.command ?? ''))) {
    fallbackOwnerRepo = fallbackOwnerRepoFromCwd(cwd);
  }

  const touch = extractTouch(input, fallbackOwnerRepo);
  if (!touch || touch.action !== 'create_issue' || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    emitEmpty();
    return;
  }

  recordCreatedIssue(sessionIssuesFilePath(input.session_id), { owner: touch.owner, repo: touch.repo, number: touch.number });
  emitEmpty();
}

main();
