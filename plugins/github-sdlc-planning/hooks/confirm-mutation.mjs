#!/usr/bin/env node
// engineering blueprint §7.1: PreToolUse confirmation before a project is
// created or board state is mutated. This does not replace Claude Code's own
// permission system (which already prompts on first use of an MCP tool) — it
// asks explicitly, with a reason naming exactly what is about to change, so
// the prompt the user sees is legible rather than a bare tool name.
//
// Issue #183: a hook-returned `permissionDecision: 'ask'` outranks every
// settings.json `permissions.allow` entry (Claude Code's precedence is
// deny > ask > allow, evaluated across every source) -- so this hook, unlike
// every other tool call, could never be silenced by the normal allow-list
// path, including the "Yes, and don't ask again" persisted grant. High-volume
// automated workflows (e.g. epic-pipeline driving dozens of set_field_value
// calls) had no way to opt out short of editing this file. `skipMutationConfirm`
// is that opt-out: an explicit, fail-closed pack toggle (default disabled --
// every other user/CI keeps the safety net) in `.config/gdlc/config.yml`.
import { readFileSync } from 'node:fs';
import { mcpAction } from './lib/mcp-tool-name.mjs';
import { isPackEnabled } from './lib/settings.mjs';

const MUTATING_ACTIONS = new Set([
  'create_issue',
  'update_issue',
  'add_sub_issue',
  'add_item_to_project',
  'set_field_value',
  'create_milestone',
  'assign_milestone',
  'create_discussion',
]);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

// Issues #82/#83: owner/repo and projectOwnerLogin/projectNumber are now
// optional on these tools -- an omitted value gets resolved from
// .config/gdlc/config.yml (or the global gdlc config) inside the tool call
// itself. This hook is dependency-free (no node_modules at hook-execution
// time, same constraint as in-progress.mjs) and can't resolve that config
// itself without a third re-implementation of the loader, so an omitted
// field is described honestly as "config default", never a bare "?" that
// would misrepresent an intentionally-omitted, config-resolved value as
// missing/broken input.
const CONFIG_DEFAULT = '(config default)';
// The tool wrappers (tool-defaults.ts) treat owner/repo and
// projectOwnerLogin/projectNumber as atomic pairs: both given, or both
// omitted so a config default can fill them. Exactly one given is neither
// -- it's guaranteed to throw missing_destination/missing_board_config, so
// it must not be described the same way as "will resolve from config."
const INVALID_PARTIAL_REPO = '(invalid: owner and repo must both be given or both omitted -- this call will fail)';
const INVALID_PARTIAL_PROJECT =
  '(invalid: projectOwnerLogin and projectNumber must both be given or both omitted -- this call will fail)';

function describeRepo(input) {
  const hasOwner = input?.owner !== undefined;
  const hasRepo = input?.repo !== undefined;
  if (hasOwner && hasRepo) return `${input.owner}/${input.repo}`;
  if (!hasOwner && !hasRepo) return `${CONFIG_DEFAULT} repo`;
  return INVALID_PARTIAL_REPO;
}

function describeProject(input) {
  const hasLogin = input?.projectOwnerLogin !== undefined;
  const hasNumber = input?.projectNumber !== undefined;
  if (hasLogin && hasNumber) return `project #${input.projectNumber} owned by ${input.projectOwnerLogin}`;
  if (!hasLogin && !hasNumber) return `project ${CONFIG_DEFAULT} owned by ${CONFIG_DEFAULT}`;
  return INVALID_PARTIAL_PROJECT;
}

function describe(toolName, input) {
  switch (mcpAction(toolName)) {
    case 'create_issue':
      return `Create issue "${input?.title ?? '(untitled)'}" in ${describeRepo(input)}.`;
    case 'add_item_to_project':
      return `Add issue #${input?.issueNumber ?? '?'} to ${describeProject(input)}.`;
    case 'set_field_value':
      return `Set field ${input?.fieldId ?? '?'} on item ${input?.itemId ?? '?'} in ${describeProject(input)}.`;
    default:
      return `${toolName} will mutate GitHub state for ${describeRepo(input)}.`;
  }
}

function main() {
  const input = readStdin();
  if (!MUTATING_ACTIONS.has(mcpAction(input.tool_name))) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  if (isPackEnabled('skipMutationConfirm')) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: describe(input.tool_name, input.tool_input),
      },
    }),
  );
}

main();
