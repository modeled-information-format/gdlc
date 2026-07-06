#!/usr/bin/env node
// engineering blueprint §7.1: PreToolUse confirmation before a project is
// created or board state is mutated. This does not replace Claude Code's own
// permission system (which already prompts on first use of an MCP tool) — it
// asks explicitly, with a reason naming exactly what is about to change, so
// the prompt the user sees is legible rather than a bare tool name.
import { readFileSync } from 'node:fs';

const MUTATING_TOOLS = new Set([
  'mcp__github-sdlc-planning__create_issue',
  'mcp__github-sdlc-planning__update_issue',
  'mcp__github-sdlc-planning__add_sub_issue',
  'mcp__github-sdlc-planning__add_item_to_project',
  'mcp__github-sdlc-planning__set_field_value',
  'mcp__github-sdlc-planning__create_milestone',
  'mcp__github-sdlc-planning__assign_milestone',
  'mcp__github-sdlc-planning__create_discussion',
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

function describeRepo(input) {
  if (input?.owner && input?.repo) return `${input.owner}/${input.repo}`;
  return `${CONFIG_DEFAULT} repo`;
}

function describeProject(input) {
  const login = input?.projectOwnerLogin ?? CONFIG_DEFAULT;
  const number = input?.projectNumber !== undefined ? `#${input.projectNumber}` : CONFIG_DEFAULT;
  return `project ${number} owned by ${login}`;
}

function describe(toolName, input) {
  switch (toolName) {
    case 'mcp__github-sdlc-planning__create_issue':
      return `Create issue "${input?.title ?? '(untitled)'}" in ${describeRepo(input)}.`;
    case 'mcp__github-sdlc-planning__add_item_to_project':
      return `Add issue #${input?.issueNumber ?? '?'} to ${describeProject(input)}.`;
    case 'mcp__github-sdlc-planning__set_field_value':
      return `Set field ${input?.fieldId ?? '?'} on item ${input?.itemId ?? '?'} in ${describeProject(input)}.`;
    default: {
      const target = input?.owner && input?.repo ? describeRepo(input) : (input?.projectOwnerLogin ?? describeRepo(input));
      return `${toolName} will mutate GitHub state for ${target}.`;
    }
  }
}

function main() {
  const input = readStdin();
  if (!MUTATING_TOOLS.has(input.tool_name)) {
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
