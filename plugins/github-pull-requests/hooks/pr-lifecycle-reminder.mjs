#!/usr/bin/env node
// issue #185/#187: PostToolUse reminder on create_pull_request -- when
// prLifecycle.requireCopilotReview is enabled, tells the agent to request
// Copilot review now (request_review with reviewers: ["Copilot"]).
// Advisory only (additionalContext), never blocks -- matches this
// codebase's other PostToolUse hooks (hygiene-check.mjs). Fires on every
// SUCCESSFUL create_pull_request call while the toggle is on (Copilot
// review finding: an earlier revision's doc comment claimed "successful"
// but the implementation never actually checked tool_output, so it would
// have reminded to review a PR that failed to open); it does not try to
// detect whether Copilot was already requested in a prior turn (that check
// belongs to check_pr_readiness -- see
// plugins/github-pull-requests/mcp-server/src/tools/pr-readiness.ts -- not
// to a fire-and-forget reminder).
import { readFileSync } from 'node:fs';
import { resolvePrLifecycle } from './lib/pr-lifecycle-config.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** `tool_output` for an MCP tool call may arrive as a JSON string, an
 * already-parsed object, or the MCP content-array shape
 * ({content:[...], isError:true}) -- same defensive handling as
 * validate-mif.mjs's extractBody, generalized to just the isError flag.
 * A tool_output this hook can't parse at all is treated as success (this
 * hook is advisory only; failing to detect a failure just means one extra
 * reminder, not a false block). */
function toolCallSucceeded(toolOutput) {
  let value = toolOutput;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return true;
    }
  }
  if (value === null || typeof value !== 'object') return true;
  return value.isError !== true;
}

function main() {
  const input = readStdin();
  const config = resolvePrLifecycle();
  if (!config.enabled || !config.requireCopilotReview || !toolCallSucceeded(input.tool_output)) {
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
