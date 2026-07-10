#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { requestReview, listReviewRequests, removeReviewRequest } from './tools/reviews.js';
import { getLinkedIssues } from './tools/linked-issues.js';
import { createPullRequest } from './tools/create-pull-request.js';
import { classifyPullRequest, PR_TYPES, PR_RISKS } from './tools/classify-pull-request.js';
import { addPullRequestToProject } from './tools/pr-projects.js';
import { syncLinkedIssuesProjectField } from './tools/sync-linked-issues-project-field.js';
import { isPrError } from './errors.js';

const server = new McpServer({ name: 'github-pull-requests', version: '0.7.1' });

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
const projectOwnerTypeSchema = z.enum(['organization', 'user']);
const fieldValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('number'), number: z.number() }),
  z.object({ kind: z.literal('date'), date: z.string() }),
  z.object({ kind: z.literal('singleSelect'), optionId: z.string() }),
  z.object({ kind: z.literal('iteration'), iterationId: z.string() }),
]);

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

server.registerTool(
  'create_pull_request',
  {
    title: 'Create pull request',
    description: 'Open a pull request via the GraphQL createPullRequest mutation.',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      body: z.string().optional(),
      baseRefName: z.string(),
      headRefName: z.string(),
      draft: z.boolean().optional(),
    },
  },
  wrap(createPullRequest),
);

server.registerTool(
  'classify_pull_request',
  {
    title: 'Classify pull request',
    description:
      'Apply type/size/risk labels to a pull request. Size is computed automatically from the diff; type is required, risk is optional. Same-category labels are replaced, not accumulated.',
    inputSchema: {
      ...pullRequestRefSchema,
      type: z.enum(PR_TYPES),
      risk: z.enum(PR_RISKS).optional(),
    },
  },
  wrap(classifyPullRequest),
);

server.registerTool(
  'add_pull_request_to_project',
  {
    title: 'Add pull request to project',
    description: 'Add a pull request to a Projects v2 board via addProjectV2ItemById.',
    inputSchema: {
      ...pullRequestRefSchema,
      projectOwnerLogin: z.string(),
      projectNumber: z.number().int(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(addPullRequestToProject),
);

server.registerTool(
  'sync_linked_issues_project_field',
  {
    title: 'Sync linked issues project field',
    description:
      'For a merged pull request, set a Projects v2 field on every same-repo issue it closes (requires the PR to be merged; matches issues to project items by number; closing issues in a different repo are reported in skippedCrossRepo, never guessed at).',
    inputSchema: {
      ...pullRequestRefSchema,
      projectOwnerLogin: z.string(),
      projectNumber: z.number().int(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      fieldId: z.string(),
      value: fieldValueSchema,
    },
  },
  wrap(syncLinkedIssuesProjectField),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-pull-requests MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
