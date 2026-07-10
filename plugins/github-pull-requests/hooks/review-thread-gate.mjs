#!/usr/bin/env node
// gdlc#202/#211: PreToolUse gate on worktree/branch creation. Mirrors
// pr-lifecycle-gate.mjs's PreToolUse/permissionDecision:'ask' shape (this
// plugin's PR-lifecycle hook family, distinct from ADR-0007's
// stricter/advisory-only hygiene family) -- 'ask' rather than a hard block,
// since a hook can observe but not itself resolve threads; it surfaces the
// exact CLAUDE.local.md rule this closes the mechanical gap for
// ("Before creating any new worktree/branch/PR... re-check reviewThreads
// fresh on every one of them"), which previously depended entirely on
// agent diligence with no gate backing it.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { isWorktreeOrBranchCreation, checkUnresolvedReviewThreads, buildGateReason } from './lib/review-thread-gate.mjs';
import { resolvePrLifecycle } from './lib/pr-lifecycle-config.mjs';
import { sessionPrsFilePath, readOpenedPrs } from './lib/session-prs.mjs';

const execFileAsync = promisify(execFile);

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

function emitAsk(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: reason,
      },
    }),
  );
}

/** Async wrapper around `gh api graphql` (code-review finding: the
 * original sync execFileSync serialized every PR's round trip even when
 * checkUnresolvedReviewThreads below fires them concurrently -- a blocking
 * subprocess call can't overlap with anything else in the same process). */
async function runGraphQL(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const { stdout } = await execFileAsync('gh', args, { encoding: 'utf8' });
  const parsed = JSON.parse(stdout);
  if (parsed.errors?.length) throw new Error(parsed.errors.map((e) => e.message).join('; '));
  return parsed.data;
}

async function main() {
  const input = readStdin();

  // Code-review finding: this cheap, synchronous check must run BEFORE the
  // config read below, not after -- hooks.json's matcher for this hook is
  // the unscoped `Bash` pattern (every Bash call in a session), and
  // resolvePrLifecycle does a real upward directory search plus a file
  // read and YAML parse. Gating that behind the free regex check first is
  // the same ordering hygiene-check.mjs's own entrypoint already uses for
  // its git-remote shell-out, for the identical reason: an unrelated
  // command (`ls`, `npm test`, ...) must never pay for work only a
  // worktree/branch-creation command needs.
  if (!isWorktreeOrBranchCreation(input.tool_name, input.tool_input)) {
    emitEmpty();
    return;
  }

  const cwd = input.cwd ?? process.cwd();
  const config = resolvePrLifecycle(cwd);
  if (!config.enabled || !config.gateNewWorkOnUnresolvedThreads || !input.session_id) {
    emitEmpty();
    return;
  }

  const prs = readOpenedPrs(sessionPrsFilePath(input.session_id));
  if (prs.length === 0) {
    emitEmpty();
    return;
  }

  try {
    const flagged = await checkUnresolvedReviewThreads(prs, runGraphQL);
    if (flagged.length > 0) {
      emitAsk(buildGateReason(flagged));
      return;
    }
  } catch {
    // fail open: a hook must never block the tool call it observes over
    // its own infrastructure failure (gh missing, auth failure, ...)
  }
  emitEmpty();
}

main().catch(() => emitEmpty());
