#!/usr/bin/env node
// ADR-0003 (docs/decisions/adr-0003-board-status-hygiene.md): PostToolUse hook
// (matcher covers add_sub_issue/update_issue/Write/Edit/MultiEdit -- the
// last three per gdlc#204/#214) that moves a Todo-or-unset board item to In
// Progress the moment work starts against it, closing the one gap native
// Projects v2 workflows don't cover. A hook process runs outside the MCP
// JSON-RPC session and cannot invoke set_field_value directly, so this
// performs the identical updateProjectV2ItemFieldValue mutation via
// `gh api graphql`, the same graceful-degradation path session-start.mjs
// documents. Config-gated on .config/gdlc/config.yml's board: section
// (ADR-0004/ADR-0006); every failure path (gh missing, auth failure,
// GraphQL error, malformed stdin, unconfigured board) is a silent no-op.
// A hook must never break the tool call it observes.
//
// gdlc#204/#214: add_sub_issue/update_issue's own extractAffectedIssue path
// records the resolved owner/repo/number as this session's "active issue"
// (first-edit-scratch.mjs) on every call, whether or not a flip happens --
// the only channel a later Write/Edit/MultiEdit touch has into "which issue
// is this edit for," since neither of those tools' input carries any issue
// reference. The first Write/Edit/MultiEdit in a session then reads that
// active issue back and runs the identical flip logic against it, gated by
// a small promoted-set marker so the second, third, ... edit against the
// same item skips the GraphQL round trip entirely rather than re-querying
// an already-settled item on every single edit.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readBoardConfig, extractAffectedIssue, setIssueInProgress, buildAdditionalContext, FIRST_EDIT_TOOL_NAMES } from './lib/in-progress.mjs';
import { activeIssuePath, promotedPath, writeActiveIssue, readActiveIssue, issueKey, readPromotedSet, markPromoted } from './lib/first-edit-scratch.mjs';

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

/** Original path: add_sub_issue/update_issue names its own affected issue
 * directly. Also records it as this session's active issue for the
 * first-edit path below, unconditionally -- even a call that turns out
 * ineligible (already In Progress, not on the board) is still the most
 * recent signal of "what's being worked on right now." */
async function handleIssueTouch(input, config, affected) {
  if (input.session_id) writeActiveIssue(activeIssuePath(input.session_id), affected);

  try {
    const result = await setIssueInProgress(affected, config, runGraphQL);
    if (result.changed) {
      emitContext(buildAdditionalContext(affected));
      return;
    }
  } catch {
    // fall through to emitEmpty
  }
  emitEmpty();
}

/** gdlc#204/#214: a Write/Edit/MultiEdit touch carries no issue reference
 * of its own -- resolve it from this session's active-issue scratch
 * instead. No session id, no recorded active issue, or an item already
 * checked this session (the promoted-set gate) are all silent no-ops. */
async function handleFirstEdit(input, config) {
  const sessionId = input.session_id;
  if (!sessionId) {
    emitEmpty();
    return;
  }

  const active = readActiveIssue(activeIssuePath(sessionId));
  if (!active) {
    emitEmpty();
    return;
  }

  const key = issueKey(active);
  const pPath = promotedPath(sessionId);
  if (readPromotedSet(pPath).includes(key)) {
    emitEmpty();
    return;
  }
  // Marked BEFORE the network round trip, not after: an ineligible or
  // failed check must not retry on every subsequent edit either -- once
  // this session has asked the question for this item, it never asks
  // again, regardless of the answer.
  markPromoted(pPath, key);

  try {
    const result = await setIssueInProgress(active, config, runGraphQL);
    if (result.changed) {
      emitContext(buildAdditionalContext(active));
      return;
    }
  } catch {
    // fall through to emitEmpty
  }
  emitEmpty();
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
  if (affected) {
    await handleIssueTouch(input, config, affected);
    return;
  }

  if (FIRST_EDIT_TOOL_NAMES.has(input.tool_name)) {
    await handleFirstEdit(input, config);
    return;
  }

  emitEmpty();
}

// Top-level catch: nothing before main's inner try can throw today, but a
// hook must never break the tool call it observes, so the fail-closed
// contract is enforced here too rather than assumed of future edits.
main().catch(() => emitEmpty());
