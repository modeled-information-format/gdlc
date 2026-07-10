#!/usr/bin/env node
// AC-9: PostToolUse hook (matcher: any of this plugin's own MCP tool calls,
// bare or plugin-qualified) — validates the MIF comment block on every
// created/updated issue. On failure, returns a correction instruction via
// hookSpecificOutput.additionalContext rather than silently letting a
// non-conformant body through. Imports the same isMifConformant the MCP
// server's own format/parse tools use (built dist, not a re-implemented
// regex) so the check can never drift from what the core actually writes.
import { readFileSync } from 'node:fs';
import { isMifConformant } from '../mcp-server/dist/mif.js';
import { mcpAction } from './lib/mcp-tool-name.mjs';

const RELEVANT_ACTIONS = new Set(['create_issue', 'update_issue']);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

/** `tool_output` for an MCP tool call may arrive as a JSON string, an already
 * -parsed object, or the MCP content-array shape ({content:[{type:'text',
 * text:'...'}]}) — handle all three rather than assuming one. */
function extractBody(toolOutput) {
  let value = toolOutput;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== 'object') return null;
  if (typeof value.body === 'string') return value.body;
  if (Array.isArray(value.content)) {
    const textPart = value.content.find((part) => typeof part?.text === 'string');
    if (textPart) {
      try {
        const inner = JSON.parse(textPart.text);
        if (typeof inner.body === 'string') return inner.body;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function main() {
  const input = readStdin();
  if (!RELEVANT_ACTIONS.has(mcpAction(input.tool_name))) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const body = extractBody(input.tool_output);
  if (body === null) {
    // update_issue's result doesn't echo the body — nothing to check here;
    // create_issue's does, and is what this hook is really guarding.
    process.stdout.write(JSON.stringify({}));
    return;
  }
  if (isMifConformant(body)) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          'The issue body returned by ' +
          input.tool_name +
          ' is missing a valid MIF frontmatter block ' +
          '(<!-- mif-id/mif-type/mif-ns -->). Call format_mif_issue_body to correct it and update_issue with the ' +
          'corrected body before proceeding — every issue this plugin writes must be MIF-conformant.',
      },
    }),
  );
}

main();
