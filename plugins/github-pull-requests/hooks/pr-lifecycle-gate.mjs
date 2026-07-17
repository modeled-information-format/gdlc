#!/usr/bin/env node
// issue #185/#187: PreToolUse gate on create_pull_request, mirroring
// github-sdlc-planning's confirm-mutation.mjs pattern -- reminds the agent
// to run the configured local-review command before a PR is opened.
//
// This hook does NOT and CANNOT literally run `localReviewer` itself: a
// PreToolUse hook can only spawn an OS process (node/bash), it cannot
// invoke a Claude Code slash command or skill, and `localReviewer`'s
// default value (`/code-review --fix`) is exactly that -- a
// slash command. So this asks explicitly, naming the exact command, the
// same legible-confirmation contract confirm-mutation.mjs already
// established for board mutations. See hooks/lib/pr-lifecycle-config.mjs's
// doc comment for the full rationale.
//
// issue #275: whether that "ask" is a hard block or a non-blocking reminder
// is now a separate toggle (`prLifecycle.confirmLocalReview`, default
// `false`) -- same opt-out shape as `skipMutationConfirm`. Before this,
// `requireLocalReview` had exactly one behavior (hard `'ask'`) with no way
// to keep the reminder while dropping the prompt short of disabling the
// whole check.
import { readFileSync } from 'node:fs';
import { resolvePrLifecycle } from './lib/pr-lifecycle-config.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  // tool_name/tool_input are unread: hooks.json's matcher already pins this
  // hook to create_pull_request only, so there is nothing left to branch on.
  readStdin();
  const config = resolvePrLifecycle();
  if (!config.enabled || !config.requireLocalReview) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: config.confirmLocalReview ? 'ask' : 'allow',
        permissionDecisionReason: `prLifecycle.requireLocalReview is enabled: run \`${config.localReviewer}\` and fix its findings before opening this PR. A hook cannot run this for you -- it can only remind you.`,
      },
    }),
  );
}

main();
