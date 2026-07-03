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

function describe(toolName, input) {
  const target = input?.owner && input?.repo ? `${input.owner}/${input.repo}` : (input?.projectOwnerLogin ?? 'the target repo/project');
  switch (toolName) {
    case 'mcp__github-sdlc-planning__create_issue':
      return `Create issue "${input?.title ?? '(untitled)'}" in ${target}.`;
    case 'mcp__github-sdlc-planning__add_item_to_project':
      return `Add issue #${input?.issueNumber ?? '?'} to project #${input?.projectNumber ?? '?'} owned by ${target}.`;
    case 'mcp__github-sdlc-planning__set_field_value':
      return `Set field ${input?.fieldId ?? '?'} on item ${input?.itemId ?? '?'} in project owned by ${target}.`;
    default:
      return `${toolName} will mutate GitHub state for ${target}.`;
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
