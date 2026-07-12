#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { getBranchProtection, updateBranchProtection, deleteBranchProtection } from './tools/branch-protection.js';
import { listRepoRulesets, getRepoRuleset } from './tools/rulesets.js';
import { listOrgHealthFiles, getOrgHealthFile } from './tools/community-health.js';
import { getPagesConfig } from './tools/pages.js';
import { listCustomPropertiesSchema, getRepoCustomProperties, setRepoCustomProperties } from './tools/custom-properties.js';
import { isRepoConfigError } from './errors.js';

const server = new McpServer({ name: 'github-repo-config', version: '0.10.3' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isRepoConfigError(err)) {
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
const branchRefSchema = { ...repoRefSchema, branch: z.string() };

server.registerTool(
  'get_branch_protection',
  { title: 'Get branch protection', description: 'Read the current branch-protection config for a branch.', inputSchema: branchRefSchema },
  wrap(getBranchProtection),
);

server.registerTool(
  'update_branch_protection',
  {
    title: 'Update branch protection',
    description:
      'Set the full branch-protection config for a branch (required status checks, enforce-admins, required approving review count). GitHub requires the full desired state in one call, not a partial patch — all three fields are required here for that reason: an omitted field is not "leave as-is", it would silently disable that protection.',
    inputSchema: {
      ...branchRefSchema,
      requiredStatusChecks: z.object({ strict: z.boolean(), contexts: z.array(z.string()) }).nullable(),
      enforceAdmins: z.boolean(),
      requiredApprovingReviewCount: z.number().int().nullable(),
    },
  },
  wrap(updateBranchProtection),
);

server.registerTool(
  'delete_branch_protection',
  {
    title: 'Delete branch protection',
    description:
      'Remove all protection from a branch, opening its merge gate entirely. Requires confirmBranch to equal branch — a mismatch is refused before any API call.',
    inputSchema: { ...branchRefSchema, confirmBranch: z.string() },
  },
  wrap(deleteBranchProtection),
);

server.registerTool(
  'list_repo_rulesets',
  { title: 'List repo rulesets', description: "List a repository's rulesets (the forward-compatible successor to branch protection).", inputSchema: repoRefSchema },
  wrap(listRepoRulesets),
);

server.registerTool(
  'get_repo_ruleset',
  { title: 'Get repo ruleset', description: 'Get a single ruleset by id, including its bypass actors.', inputSchema: { ...repoRefSchema, rulesetId: z.number().int() } },
  wrap(getRepoRuleset),
);

server.registerTool(
  'list_org_health_files',
  {
    title: 'List org health files',
    description: "List default community health files/templates in the org's .github repo (never .github-private).",
    inputSchema: { org: z.string(), path: z.string().optional() },
  },
  wrap(listOrgHealthFiles),
);

server.registerTool(
  'get_org_health_file',
  {
    title: 'Get org health file',
    description: "Read a default community health file's content from the org's .github repo.",
    inputSchema: { org: z.string(), path: z.string() },
  },
  wrap(getOrgHealthFile),
);

server.registerTool(
  'get_pages_config',
  { title: 'Get Pages config', description: "Read a repository's GitHub Pages configuration and status.", inputSchema: repoRefSchema },
  wrap(getPagesConfig),
);

server.registerTool(
  'list_custom_properties_schema',
  { title: 'List custom properties schema', description: "List an org's custom repository-property definitions.", inputSchema: { org: z.string() } },
  wrap(listCustomPropertiesSchema),
);

server.registerTool(
  'get_repo_custom_properties',
  { title: 'Get repo custom properties', description: "Get a repository's custom property values.", inputSchema: repoRefSchema },
  wrap(getRepoCustomProperties),
);

server.registerTool(
  'set_repo_custom_properties',
  {
    title: 'Set repo custom properties',
    description:
      'Bulk-set custom property values across the named repos in one org-level write — can retarget ruleset enforcement across every named repo. Requires confirmRepoCount to equal repoNames.length; a mismatch is refused before any API call.',
    inputSchema: {
      org: z.string(),
      repoNames: z.array(z.string()),
      properties: z.array(z.object({ propertyName: z.string(), value: z.union([z.string(), z.array(z.string()), z.null()]) })),
      confirmRepoCount: z.number().int(),
    },
  },
  wrap(setRepoCustomProperties),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-repo-config MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
