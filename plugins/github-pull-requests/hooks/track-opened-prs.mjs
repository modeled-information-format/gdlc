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
// time. The whole prLifecycle feature family is off by default (enabled:
// false) -- gateNewWorkOnUnresolvedThreads itself defaults to true once
// the family is opted into, same "strictest sane behavior once enabled"
// convention as prLifecycle's other require* toggles (see config.ts's
// resolvePrLifecycleConfig doc comment); if the family is off, tracking
// PRs for a gate that can never fire is pointless overhead.
import { execFileSync } from 'node:child_process';
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

/** Code-review finding: `extractTouch(input, null)` with a hardcoded null
 * fallback silently disabled this hook for the common `gh pr create`
 * invocation with no explicit `--repo` flag (the normal case when run
 * from inside the target repo's checkout) -- extractTouch's gh-cli branch
 * has no owner/repo to fall back to, so the touch is rejected and no PR
 * ever gets tracked. Same cwd-derived-from-git-remote fallback
 * hygiene-check.mjs's own entrypoint already uses, duplicated here rather
 * than imported since this file (unlike hygiene-check.mjs) is not part of
 * the drift-checked hygiene family. */
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

  const config = resolvePrLifecycle(cwd);
  if (!config.enabled || !config.gateNewWorkOnUnresolvedThreads || !input.session_id) {
    emitEmpty();
    return;
  }

  // Same cheap-regex-before-shell-out gating hygiene-check.mjs's entrypoint
  // uses: only pay for the git remote shell-out when the command is
  // plausibly a `gh pr create` at all.
  let fallbackOwnerRepo = null;
  if (input.tool_name === 'Bash' && /^\s*gh\s+pr\s+create\b/.test(String(input.tool_input?.command ?? ''))) {
    fallbackOwnerRepo = fallbackOwnerRepoFromCwd(cwd);
  }

  const touch = extractTouch(input, fallbackOwnerRepo);
  if (!touch || touch.action !== 'create_pull_request' || typeof touch.owner !== 'string' || typeof touch.repo !== 'string' || typeof touch.number !== 'number') {
    emitEmpty();
    return;
  }

  recordOpenedPr(sessionPrsFilePath(input.session_id), { owner: touch.owner, repo: touch.repo, pullNumber: touch.number });
  emitEmpty();
}

main();
