#!/usr/bin/env node
// ADR-0003 (docs/decisions/adr-0003-board-status-hygiene.md): PostToolUse hook
// (matcher covers add_sub_issue/update_issue) that moves a Todo-or-unset board
// item to In Progress the moment work starts against it, closing the one gap
// native Projects v2 workflows don't cover. A hook process runs outside the
// MCP JSON-RPC session and cannot invoke set_field_value directly, so this
// performs the identical updateProjectV2ItemFieldValue mutation via
// `gh api graphql`, the same graceful-degradation path session-start.mjs
// documents. Config-gated on .claude/github-sdlc-planning.local.md; every
// failure path (gh missing, auth failure, GraphQL error, malformed stdin,
// unconfigured board) is a silent no-op. A hook must never break the tool
// call it observes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readBoardConfig, extractAffectedIssue, setIssueInProgress, buildAdditionalContext } from './lib/in-progress.mjs';

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

function emitContext(text) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }),
  );
}

/** The one function in this file that talks to GitHub, a thin wrapper
 * around `gh api graphql` that setIssueInProgress calls for every round
 * trip. Numbers/booleans go through `-F` (typed), everything else through
 * `-f` (string), matching `gh`'s own convention. */
function runGraphQL(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const raw = execFileSync('gh', args, { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((e) => e.message).join('; '));
  }
  return parsed.data;
}

async function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();

  const config = readBoardConfig(cwd);
  if (!config) {
    emitEmpty();
    return;
  }

  const affected = extractAffectedIssue(input);
  if (!affected) {
    emitEmpty();
    return;
  }

  try {
    const result = await setIssueInProgress(affected, config, runGraphQL);
    if (result.changed) {
      emitContext(buildAdditionalContext(affected));
      return;
    }
    emitEmpty();
  } catch {
    emitEmpty();
  }
}

// Top-level catch: nothing before main's inner try can throw today, but a
// hook must never break the tool call it observes, so the fail-closed
// contract is enforced here too rather than assumed of future edits.
main().catch(() => emitEmpty());
