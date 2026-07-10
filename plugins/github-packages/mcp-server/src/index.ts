#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  listOrgPackages,
  getOrgPackage,
  listPackageVersions,
  getPackageVersion,
  deletePackage,
  deletePackageVersion,
  restorePackage,
  restorePackageVersion,
} from './tools/packages.js';
import { isPackagesError } from './errors.js';

const server = new McpServer({ name: 'github-packages', version: '0.9.0' });

function toolResult(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): { isError: true; content: Array<{ type: 'text'; text: string }> } {
  if (isPackagesError(err)) {
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

const packageTypeSchema = z.enum(['npm', 'maven', 'rubygems', 'docker', 'container', 'nuget', 'generic']);
const packageRefSchema = { org: z.string(), packageType: packageTypeSchema, packageName: z.string() };

/** Exported for a regression test: packageType must be required here, not
 * just in ListOrgPackagesInput's TS type -- this zod schema is the runtime
 * boundary a real MCP caller actually hits, and TS-required alone would
 * never catch a caller passing a bare object with no packageType. */
export const listOrgPackagesInputSchema = z.object({ org: z.string(), packageType: packageTypeSchema });

server.registerTool(
  'list_org_packages',
  {
    title: 'List org packages',
    description: "List an org's packages of a given package type. GitHub's real endpoint requires package_type -- there is no single call that lists every type at once.",
    inputSchema: listOrgPackagesInputSchema.shape,
  },
  wrap(listOrgPackages),
);

server.registerTool(
  'get_org_package',
  { title: 'Get org package', description: 'Get a single package by name and type.', inputSchema: packageRefSchema },
  wrap(getOrgPackage),
);

server.registerTool(
  'list_package_versions',
  { title: 'List package versions', description: 'List the versions of a package.', inputSchema: packageRefSchema },
  wrap(listPackageVersions),
);

server.registerTool(
  'get_package_version',
  { title: 'Get package version', description: 'Get a single package version by id.', inputSchema: { ...packageRefSchema, versionId: z.number().int() } },
  wrap(getPackageVersion),
);

server.registerTool(
  'delete_package',
  {
    title: 'Delete package',
    description:
      'Delete an entire package. Restorable only within GitHub\'s ~30-day window and only if nothing has since republished under the same name. Requires confirmPackageName to equal packageName; a mismatch is refused before any API call.',
    inputSchema: { ...packageRefSchema, confirmPackageName: z.string() },
  },
  wrap(deletePackage),
);

server.registerTool(
  'delete_package_version',
  {
    title: 'Delete package version',
    description:
      'Delete a single package version. Restorable only within GitHub\'s ~30-day window and only if nothing has since republished under the same version. Requires confirmVersionId to equal versionId; a mismatch is refused before any API call.',
    inputSchema: { ...packageRefSchema, versionId: z.number().int(), confirmVersionId: z.number().int() },
  },
  wrap(deletePackageVersion),
);

server.registerTool(
  'restore_package',
  {
    title: 'Restore package',
    description: "Restore a deleted package, within GitHub's ~30-day window. No confirm-echo guard: restoring undoes a delete rather than causing new loss.",
    inputSchema: packageRefSchema,
  },
  wrap(restorePackage),
);

server.registerTool(
  'restore_package_version',
  {
    title: 'Restore package version',
    description: "Restore a deleted package version, within GitHub's ~30-day window.",
    inputSchema: { ...packageRefSchema, versionId: z.number().int() },
  },
  wrap(restorePackageVersion),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only connect stdio when run directly (node dist/index.js) -- importing
// this module for its exported schemas (as the regression test for
// listOrgPackagesInputSchema does) must not also open a stdio transport.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(`github-packages MCP server failed to start: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exit(1);
  });
}
