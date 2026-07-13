#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { createIssue, updateIssue } from './tools/issues.js';
import { addSubIssue, listSubIssues } from './tools/sub-issues.js';
import { addItemToProject, setFieldValue, getProjectItems, getProjectStatusProfile } from './tools/projects.js';
import { createMilestone, listMilestones, assignMilestone } from './tools/milestones.js';
import { createDiscussion, listDiscussions } from './tools/discussions.js';
import { getSessionContext, getAgentCapabilities } from './tools/session.js';
import { getGdlcConfig, writeGdlcConfig, GDLC_CONFIG_SECTION_SCHEMAS } from './tools/config.js';
import { formatMifIssueBody, parseMifIssueBody, MIF_ISSUE_TYPES, type MifIssueType } from './mif.js';
import { isPlanningError } from './errors.js';
import { withRequiredBoardCoordinates, withOptionalBoardCoordinates, withIssueDestination } from './tool-defaults.js';

const server = new McpServer({ name: 'github-sdlc-planning', version: '0.10.3' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isPlanningError(err)) {
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

const mifTypeSchema = z.enum(MIF_ISSUE_TYPES);
const projectOwnerTypeSchema = z.enum(['organization', 'user']);

server.registerTool(
  'create_issue',
  {
    title: 'Create issue',
    description:
      'Create a GitHub issue via the GraphQL createIssue mutation, prepending a MIF frontmatter comment block to the body before returning. owner/repo default to the configured destination.repo (issue #82) when omitted, and are always checked against the configured targeting allowlist, if any (issue #83). When issueType is omitted, it is derived from mif.type (Task->Task, Bug->Bug, everything else->Feature); an org without that native type defined degrades to no type instead of failing (issue #108).',
    inputSchema: {
      owner: z.string().optional(),
      repo: z.string().optional(),
      title: z.string(),
      body: z.string(),
      labels: z.array(z.string()).optional(),
      assignees: z.array(z.string()).optional(),
      milestoneNumber: z.number().int().optional(),
      issueType: z.string().optional(),
      mif: z.object({ id: z.string(), type: mifTypeSchema, namespace: z.string() }),
    },
  },
  wrap(withIssueDestination(createIssue)),
);

server.registerTool(
  'update_issue',
  {
    title: 'Update issue',
    description: 'Update an issue (title/body/state/issueType). Rejects an unknown issueType before calling the API.',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      number: z.number().int(),
      title: z.string().optional(),
      body: z.string().optional(),
      state: z.enum(['open', 'closed']).optional(),
      issueType: z.string().optional(),
    },
  },
  wrap(updateIssue),
);

server.registerTool(
  'add_sub_issue',
  {
    title: 'Add sub-issue',
    description:
      'Attach a child issue to a parent via the GraphQL addSubIssue mutation. Rejects with limit_exceeded at 100 sub-issues per parent or 8 nesting levels, before forwarding to GitHub.',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      parentNumber: z.number().int(),
      childNumber: z.number().int(),
      childOwner: z.string().optional(),
      childRepo: z.string().optional(),
      replaceParent: z.boolean().optional(),
    },
  },
  wrap(addSubIssue),
);

server.registerTool(
  'list_sub_issues',
  {
    title: 'List sub-issues',
    description: 'List `parentNumber`\'s sub-issues with completion summary.',
    inputSchema: { owner: z.string(), repo: z.string(), parentNumber: z.number().int() },
  },
  wrap(listSubIssues),
);

server.registerTool(
  'add_item_to_project',
  {
    title: 'Add item to project',
    description:
      'Add an issue to a Projects v2 board via addProjectV2ItemById, resolving node IDs first. Idempotent: if the ' +
      'issue already has an item on the target project (e.g. added by a native auto-add workflow), returns that ' +
      'item with existed: true instead of creating a duplicate. projectOwnerLogin/projectNumber default to the ' +
      'configured board mapping (issue #82) when omitted.',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      issueNumber: z.number().int(),
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(addItemToProject)),
);

server.registerTool(
  'set_field_value',
  {
    title: 'Set project field value',
    description:
      'Set a Projects v2 item field value via updateProjectV2ItemFieldValue. projectOwnerLogin/projectNumber ' +
      'default to the configured board mapping (issue #82) when omitted.',
    inputSchema: {
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      itemId: z.string(),
      fieldId: z.string(),
      value: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('text'), text: z.string() }),
        z.object({ kind: z.literal('number'), number: z.number() }),
        z.object({ kind: z.literal('date'), date: z.string() }),
        z.object({ kind: z.literal('singleSelect'), optionId: z.string() }),
        z.object({ kind: z.literal('iteration'), iterationId: z.string() }),
      ]),
    },
  },
  wrap(withRequiredBoardCoordinates(setFieldValue)),
);

server.registerTool(
  'get_project_items',
  {
    title: 'Get project items',
    description:
      'List a Projects v2 board\'s items and their field values. projectOwnerLogin/projectNumber default to the ' +
      'configured board mapping (issue #82) when omitted.',
    inputSchema: {
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(getProjectItems)),
);

server.registerTool(
  'get_project_status_profile',
  {
    title: 'Get project Status-field profile',
    description:
      'Read the durable, XDG-cached profile of a project\'s real Status field (option IDs/names) and which ' +
      'documented CLAUDE.md lifecycle stages (Backlog/Ready/In Progress/In Review/Done) have no matching board ' +
      'option, refreshing from a live GraphQL query only when the cache is missing or past its 1-hour TTL. ' +
      'projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted.',
    inputSchema: {
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
    },
  },
  wrap(withRequiredBoardCoordinates(getProjectStatusProfile)),
);

server.registerTool(
  'create_milestone',
  {
    title: 'Create milestone',
    description: 'Create a milestone via the REST milestones endpoint (milestones are REST-only).',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      title: z.string(),
      description: z.string().optional(),
      dueOn: z.string().optional(),
      state: z.enum(['open', 'closed']).optional(),
    },
  },
  wrap(createMilestone),
);

server.registerTool(
  'list_milestones',
  {
    title: 'List milestones',
    description: 'List a repository\'s milestones.',
    inputSchema: { owner: z.string(), repo: z.string(), state: z.enum(['open', 'closed', 'all']).optional() },
  },
  wrap(listMilestones),
);

server.registerTool(
  'assign_milestone',
  {
    title: 'Assign milestone',
    description: 'Assign (or unassign, with null) a milestone to an issue.',
    inputSchema: { owner: z.string(), repo: z.string(), issueNumber: z.number().int(), milestoneNumber: z.number().int().nullable() },
  },
  wrap(assignMilestone),
);

server.registerTool(
  'create_discussion',
  {
    title: 'Create discussion',
    description: 'Create a Discussion via the GraphQL createDiscussion mutation.',
    inputSchema: { owner: z.string(), repo: z.string(), categoryName: z.string(), title: z.string(), body: z.string() },
  },
  wrap(createDiscussion),
);

server.registerTool(
  'list_discussions',
  {
    title: 'List discussions',
    description: 'List a repository\'s discussions.',
    inputSchema: { owner: z.string(), repo: z.string() },
  },
  wrap(listDiscussions),
);

server.registerTool(
  'format_mif_issue_body',
  {
    title: 'Format MIF issue body',
    description: 'Prepend a MIF L1 frontmatter comment block (mif-id/mif-type/mif-ns) to a Markdown body.',
    inputSchema: {
      meta: z.object({ id: z.string(), type: mifTypeSchema, namespace: z.string() }),
      body: z.string(),
    },
  },
  wrap(({ meta, body }: { meta: { id: string; type: MifIssueType; namespace: string }; body: string }) =>
    formatMifIssueBody(meta, body),
  ),
);

server.registerTool(
  'parse_mif_issue_body',
  {
    title: 'Parse MIF issue body',
    description: 'Parse an issue body\'s MIF frontmatter block, if present.',
    inputSchema: { raw: z.string() },
  },
  wrap(({ raw }: { raw: string }) => parseMifIssueBody(raw)),
);

server.registerTool(
  'get_session_context',
  {
    title: 'Get session context',
    description:
      'Fetch open milestones and (optionally) Projects v2 board state — the non-Claude-Code SessionStart equivalent. ' +
      'projectOwnerLogin/projectNumber default to the configured board mapping (issue #82) when omitted; still ' +
      'optional overall, since a repo with no board configured anywhere is a valid state (projectBoard: null). ' +
      'Config-based defaulting resolves from startDir (same param as get_gdlc_config), NOT from owner/repo -- ' +
      'pass the target repo\'s actual checkout path when it differs from the MCP server process\'s own cwd, or ' +
      'this can silently default to an unrelated repo\'s board with no error (issue #274).',
    inputSchema: {
      owner: z.string(),
      repo: z.string(),
      projectOwnerLogin: z.string().optional(),
      projectNumber: z.number().int().optional(),
      projectOwnerType: projectOwnerTypeSchema.optional(),
      startDir: z.string().optional(),
    },
  },
  wrap(withOptionalBoardCoordinates(getSessionContext)),
);

server.registerTool(
  'get_gdlc_config',
  {
    title: 'Get gdlc config',
    description:
      'Resolved layered gdlc config (global + every ancestor project-layer file, ADR-0008\'s per-section cascade) ' +
      'plus a diagnostics array: every layer path checked, whether it exists, and which top-level sections it ' +
      'actually contributes -- a fuller picture than get_session_context\'s single projectConfigPath string.',
    inputSchema: { startDir: z.string().optional() },
  },
  wrap(({ startDir }: { startDir?: string }) => getGdlcConfig({ startDir })),
);

server.registerTool(
  'write_gdlc_config',
  {
    title: 'Write gdlc config',
    description:
      'Write one or more top-level sections of gdlc/config.yml (ADR-0009). Always takes an explicit layer ' +
      '(\'project\'|\'global\') and, for \'project\', an explicit root (defaults to process.cwd() -- never an ' +
      'ancestor-search result). Validates each section against its schema, mutates only the touched key(s) via ' +
      'yaml.Document.set() (preserving every other section\'s formatting/comments byte-for-byte), and supports ' +
      'dryRun to preview the resulting file content without writing.',
    inputSchema: {
      layer: z.enum(['project', 'global']),
      root: z.string().optional(),
      sections: z
        .object({
          targeting: GDLC_CONFIG_SECTION_SCHEMAS.targeting.optional(),
          destination: GDLC_CONFIG_SECTION_SCHEMAS.destination.optional(),
          board: GDLC_CONFIG_SECTION_SCHEMAS.board.optional(),
          packs: GDLC_CONFIG_SECTION_SCHEMAS.packs.optional(),
          prLifecycle: GDLC_CONFIG_SECTION_SCHEMAS.prLifecycle.optional(),
        })
        .strict(),
      dryRun: z.boolean().optional(),
    },
  },
  wrap(writeGdlcConfig),
);

server.registerTool(
  'get_agent_capabilities',
  {
    title: 'Get agent capabilities',
    description: 'Describe this MCP server\'s tool surface and MIF conformance level — feature detection for any MCP host.',
    inputSchema: {},
  },
  wrap(() => getAgentCapabilities()),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`github-sdlc-planning MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
