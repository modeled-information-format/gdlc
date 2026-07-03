#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { requestReview, listReviewRequests, removeReviewRequest } from './tools/reviews.js';
import { getLinkedIssues } from './tools/linked-issues.js';
import { isPrError } from './errors.js';

const server = new McpServer({ name: 'github-pull-requests', version: '0.1.0' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isPrError(err)) {
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

const pullRequestRefSchema = { owner: z.string(), repo: z.string(), pullNumber: z.number().int() };

server.registerTool(
  'request_review',
  {
    title: 'Request review',
    description: 'Request reviewers (and/or teams) on a pull request.',
    inputSchema: { ...pullRequestRefSchema, reviewers: z.array(z.string()).optional(), teamReviewers: z.array(z.string()).optional() },
  },
  wrap(requestReview),
);

server.registerTool(
  'list_review_requests',
  {
    title: 'List review requests',
    description: 'List the current requested reviewers and teams on a pull request.',
    inputSchema: pullRequestRefSchema,
  },
  wrap(listReviewRequests),
);

server.registerTool(
  'remove_review_request',
  {
    title: 'Remove review request',
    description: 'Remove requested reviewers (and/or teams) from a pull request.',
    inputSchema: { ...pullRequestRefSchema, reviewers: z.array(z.string()).optional(), teamReviewers: z.array(z.string()).optional() },
  },
  wrap(removeReviewRequest),
);

server.registerTool(
  'get_linked_issues',
  {
    title: 'Get linked issues',
    description:
      'Find issues linked to a pull request: closingIssuesReferences first (source: closing_reference), Timeline-API/text-parsing fallback labeled confidence: heuristic.',
    inputSchema: pullRequestRefSchema,
  },
  wrap(getLinkedIssues),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-pull-requests MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
