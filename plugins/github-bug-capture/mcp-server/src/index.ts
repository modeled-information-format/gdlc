#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getAgentCapabilities } from './capabilities.js';
import { isBugCaptureError } from './errors.js';
import { ensureSeverityField, setSeverity, SEVERITY_LEVELS } from './tools/triage-board.js';
import { getLifecycleState, setLifecycleState, searchSimilarIssues, closeAsDuplicate } from './tools/lifecycle.js';
import { withRequiredBoardCoordinates } from './tool-defaults.js';

const server = new McpServer({ name: 'github-bug-capture', version: '0.4.0' });

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
      'Ensure the triage board (a Projects v2 board) has a "Severity" single-select field with options Critical/High/Medium/Low, creating it if absent. Idempotent: an existing field is returned with its option IDs without mutating. projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted.',
    inputSchema: {
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(ensureSeverityField)),
);

server.registerTool(
  'set_severity',
  {
    title: 'Set severity',
    description:
      "Set an issue's Severity single-select value on the triage board. Fails with a typed error if the issue is not on the board or the Severity field/option is missing. projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      severity: z.enum(SEVERITY_LEVELS),
    },
  },
  wrap(withRequiredBoardCoordinates(setSeverity)),
);

server.registerTool(
  'get_lifecycle_state',
  {
    title: 'Get lifecycle state',
    description:
      "Read an issue's lifecycle state: native GitHub state (open/closed) plus the triage board's Status single-select value, if the issue is on that board. Never errors when the issue is off the board or the Status field/value is absent -- both report as a null status. projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(getLifecycleState)),
);

server.registerTool(
  'set_lifecycle_state',
  {
    title: 'Set lifecycle state',
    description:
      'Set an issue\'s Status single-select value on the triage board via the project\'s existing "Status" field (looked up by name, never created), optionally closing the underlying issue afterward when closeIfDone is true. Fails with a typed error if the issue is not on the board or the Status field/option is missing. projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted.',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      status: z.string(),
      closeIfDone: z.boolean().optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(setLifecycleState)),
);

server.registerTool(
  'search_similar_issues',
  {
    title: 'Search similar issues',
    description:
      'Find candidate duplicate issues via the REST search/issues endpoint (plain keyword search, not AI/embedding similarity -- out of scope per the research report).',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      query: z.string(),
    },
  },
  wrap(searchSimilarIssues),
);

server.registerTool(
  'close_as_duplicate',
  {
    title: 'Close as duplicate',
    description:
      "Close an issue with state_reason: duplicate via the REST PATCH endpoint, and post a comment linking to the canonical issue it duplicates.",
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      duplicateOfNumber: z.number().int(),
    },
  },
  wrap(closeAsDuplicate),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-bug-capture MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
