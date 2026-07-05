#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getAgentCapabilities } from './capabilities.js';
import { isBugCaptureError } from './errors.js';
import { ensureSeverityField, setSeverity, SEVERITY_LEVELS } from './tools/triage-board.js';

const server = new McpServer({ name: 'github-bug-capture', version: '0.1.0' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isBugCaptureError(err)) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify(err.toJSON(), null, 2) }] };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'github_api_error', message }, null, 2) }] };
}

function wrap<TArgs>(fn: (args: TArgs) => Promise<unknown> | unknown) {
  return async (args: TArgs) => {
    try {
      return toolResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
}

server.registerTool(
  'get_agent_capabilities',
  {
    title: 'Get agent capabilities',
    description:
      "Describe this MCP server's tool surface, MIF conformance level, and the sibling plugins it composes with — feature detection for any MCP host.",
    inputSchema: {},
  },
  wrap(() => getAgentCapabilities()),
);

const projectOwnerTypeSchema = z.enum(['organization', 'user']);

server.registerTool(
  'ensure_severity_field',
  {
    title: 'Ensure Severity field',
    description:
      'Ensure the triage board (a Projects v2 board) has a "Severity" single-select field with options Critical/High/Medium/Low, creating it if absent. Idempotent: an existing field is returned with its option IDs without mutating.',
    inputSchema: {
      projectOwnerLogin: z.string(),
      projectNumber: z.number().int(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(ensureSeverityField),
);

server.registerTool(
  'set_severity',
  {
    title: 'Set severity',
    description:
      "Set an issue's Severity single-select value on the triage board. Fails with a typed error if the issue is not on the board or the Severity field/option is missing.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      projectOwnerLogin: z.string(),
      projectNumber: z.number().int(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      severity: z.enum(SEVERITY_LEVELS),
    },
  },
  wrap(setSeverity),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-bug-capture MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
