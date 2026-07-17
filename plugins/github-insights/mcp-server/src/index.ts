#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getRepoTrafficViews, getRepoTrafficClones } from './tools/traffic.js';
import { getRepoContributorStats } from './tools/stats.js';
import { getCommunityProfile } from './tools/community-profile.js';
import { getDependencyGraphSbom } from './tools/dependency-graph.js';
import { isInsightsError } from './errors.js';

const server = new McpServer({ name: 'github-insights', version: '0.11.0' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isInsightsError(err)) {
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

const repoRefSchema = { owner: z.string(), repo: z.string() };

server.registerTool(
  'get_repo_traffic_views',
  { title: 'Get repo traffic views', description: "Read a repository's 14-day rolling page-view traffic.", inputSchema: repoRefSchema },
  wrap(getRepoTrafficViews),
);

server.registerTool(
  'get_repo_traffic_clones',
  { title: 'Get repo traffic clones', description: "Read a repository's 14-day rolling git-clone traffic.", inputSchema: repoRefSchema },
  wrap(getRepoTrafficClones),
);

server.registerTool(
  'get_repo_contributor_stats',
  {
    title: 'Get repo contributor stats',
    description:
      'Read per-contributor commit totals. GitHub computes this asynchronously on a cache miss; a computing: true result means retry shortly rather than treating it as zero contributors.',
    inputSchema: repoRefSchema,
  },
  wrap(getRepoContributorStats),
);

server.registerTool(
  'get_community_profile',
  {
    title: 'Get community profile',
    description: "Read a repository's community-health profile: health percentage and which default files (README, LICENSE, CONTRIBUTING, etc.) are present.",
    inputSchema: repoRefSchema,
  },
  wrap(getCommunityProfile),
);

server.registerTool(
  'get_dependency_graph_sbom',
  {
    title: 'Get dependency graph SBOM',
    description: "Read a repository's SPDX SBOM summary (spec version and package count) from the dependency graph.",
    inputSchema: repoRefSchema,
  },
  wrap(getDependencyGraphSbom),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-insights MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
