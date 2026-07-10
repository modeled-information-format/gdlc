#!/usr/bin/env node
// gdlc#202/#211: PostToolUse hook (matcher covers create_pull_request on
// both the plugin-scoped and generic github MCP surfaces, plus `gh pr
// create` via Bash) that records every PR opened this session to a
// session-scoped scratch file. review-thread-gate.mjs (PreToolUse on
// worktree/branch creation) reads it back to check whether any of them
// still has unresolved review threads before letting new work start.
// Reuses extractTouch from this plugin's own copy of hygiene-check.mjs's
// lib (already detects create_pull_request on both surfaces and extracts
// owner/repo/number) rather than re-implementing that detection a third
// time. Config-gated on prLifecycle.gateNewWorkOnUnresolvedThreads (off by
// default, matching every other prLifecycle sub-toggle) -- if the gate
// itself is disabled, tracking PRs for it is pointless overhead.
import { readFileSync } from 'node:fs';
import { extractTouch } from './lib/hygiene-check.mjs';
import { resolvePrLifecycle } from './lib/pr-lifecycle-config.mjs';
import { sessionPrsFilePath, recordOpenedPr } from './lib/session-prs.mjs';

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

function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();

  const config = resolvePrLifecycle(cwd);
  if (!config.enabled || !config.gateNewWorkOnUnresolvedThreads || !input.session_id) {
    emitEmpty();
    return;
  }

  const touch = extractTouch(input, null);
  if (!touch || touch.action !== 'create_pull_request' || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    emitEmpty();
    return;
  }

  recordOpenedPr(sessionPrsFilePath(input.session_id), { owner: touch.owner, repo: touch.repo, pullNumber: touch.number });
  emitEmpty();
}

main();
