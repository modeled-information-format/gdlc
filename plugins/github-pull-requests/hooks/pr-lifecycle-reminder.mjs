#!/usr/bin/env node
// issue #185/#187: PostToolUse reminder on create_pull_request -- when
// prLifecycle.requireCopilotReview is enabled, tells the agent to request
// Copilot review now (request_review with reviewers: ["Copilot"]).
// Advisory only (additionalContext), never blocks -- matches this
// codebase's other PostToolUse hooks (hygiene-check.mjs). Fires
// unconditionally on every successful create_pull_request call while the
// toggle is on; it does not try to detect whether Copilot was already
// requested in a prior turn (that check belongs to check_pr_readiness --
// see plugins/github-pull-requests/mcp-server/src/tools/pr-readiness.ts --
// not to a fire-and-forget reminder).
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
  readStdin();
  const config = resolvePrLifecycle();
  if (!config.enabled || !config.requireCopilotReview) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'prLifecycle.requireCopilotReview is enabled: request Copilot review now (request_review with reviewers: ["Copilot"]) before doing anything else on this PR.',
      },
    }),
  );
}

main();
