#!/usr/bin/env node
// ADR-0010: SessionStart hook (matcher covers startup/resume/clear/compact
// -- every way a session comes into being or re-materializes) that records
// the cwd -> session_id pointer this plugin's background monitors resolve
// their session context from. See hooks/lib/session-pointer.mjs for the
// full contract; this entrypoint is byte-copied into every monitor-bearing
// plugin and drift-checked alongside it, so it must stay free of any
// plugin-specific code reference. Each plugin also refreshes the same
// pointer mid-session from its own already-firing PostToolUse hooks that
// are NOT part of a drift-checked family (set-in-progress.mjs in
// github-sdlc-planning, track-opened-prs.mjs in github-pull-requests,
// track-created-issues.mjs in github-bug-capture), so a monitor's
// freshness check keeps resolving the session as long as work is actually
// happening in it.
//
// Every failure path is a silent no-op emitting `{}` -- a hook must never
// break the session event it observes.
import { readFileSync } from 'node:fs';
import { pointerFilePath, writeSessionPointer } from './lib/session-pointer.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();
  if (typeof input.session_id === 'string' && input.session_id !== '') {
    writeSessionPointer(pointerFilePath(cwd), { sessionId: input.session_id, cwd, updatedAt: Date.now() });
  }
  process.stdout.write(JSON.stringify({}));
}

main();
