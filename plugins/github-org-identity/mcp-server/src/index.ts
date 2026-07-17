#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  listOrganizationRoles,
  listRoleTeams,
  listRoleUsers,
  assignTeamRole,
  removeTeamRole,
  assignUserRole,
  removeUserRole,
} from './tools/roles.js';
import { isOrgIdentityError } from './errors.js';

const server = new McpServer({ name: 'github-org-identity', version: '0.11.2' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isOrgIdentityError(err)) {
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

const roleRefSchema = { org: z.string(), roleId: z.number().int() };

server.registerTool(
  'list_organization_roles',
  {
    title: 'List organization roles',
    description: "List an org's predefined and custom organization roles.",
    inputSchema: { org: z.string() },
  },
  wrap(listOrganizationRoles),
);

server.registerTool(
  'list_role_teams',
  {
    title: 'List role teams',
    description: 'List the teams holding a given organization role.',
    inputSchema: roleRefSchema,
  },
  wrap(listRoleTeams),
);

server.registerTool(
  'list_role_users',
  {
    title: 'List role users',
    description: 'List the users holding a given organization role, directly or via team membership.',
    inputSchema: roleRefSchema,
  },
  wrap(listRoleUsers),
);

const confirmEchoDescription =
  'Mutates org-wide permissions. Requires confirmRoleId to equal roleId — a deliberate two-field echo guard against an accidental or hallucinated single-shot invocation; a mismatch is refused before any API call.';

server.registerTool(
  'assign_team_role',
  {
    title: 'Assign team role',
    description: `Assign an organization role to a team. ${confirmEchoDescription}`,
    inputSchema: { ...roleRefSchema, confirmRoleId: z.number().int(), teamSlug: z.string() },
  },
  wrap(assignTeamRole),
);

server.registerTool(
  'remove_team_role',
  {
    title: 'Remove team role',
    description: `Remove an organization role from a team. ${confirmEchoDescription}`,
    inputSchema: { ...roleRefSchema, confirmRoleId: z.number().int(), teamSlug: z.string() },
  },
  wrap(removeTeamRole),
);

server.registerTool(
  'assign_user_role',
  {
    title: 'Assign user role',
    description: `Assign an organization role to a user. ${confirmEchoDescription}`,
    inputSchema: { ...roleRefSchema, confirmRoleId: z.number().int(), username: z.string() },
  },
  wrap(assignUserRole),
);

server.registerTool(
  'remove_user_role',
  {
    title: 'Remove user role',
    description: `Remove an organization role from a user. ${confirmEchoDescription}`,
    inputSchema: { ...roleRefSchema, confirmRoleId: z.number().int(), username: z.string() },
  },
  wrap(removeUserRole),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-org-identity MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
