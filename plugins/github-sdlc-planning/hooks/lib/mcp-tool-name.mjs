/**
 * Shared by every github-sdlc-planning hook that needs to identify which
 * MCP tool a hook payload's `tool_name` refers to (confirm-mutation.mjs,
 * validate-mif.mjs, in-progress.mjs). Not part of the hygiene-check.mjs/
 * hygiene-aggregate.mjs/lib byte-identical-copy family the
 * hygiene-hook-drift-check CI job guards -- this file is
 * github-sdlc-planning-only, no sibling-plugin copy exists or is needed.
 *
 * Deliberately a plain relative import, not an npm package: these hooks run
 * dependency-free (no node_modules at hook-execution time), but a local
 * sibling file within the plugin is not a dependency in that sense --
 * validate-mif.mjs already imports across the hooks/ -> mcp-server/dist
 * boundary the same way.
 */

/** Extract the bare action from an MCP tool name, tolerant of both the bare
 * form Claude Code uses for a directly-registered MCP server
 * (`mcp__github-sdlc-planning__create_issue`) and the plugin-qualified form
 * it uses when this plugin's MCP server is installed via a marketplace
 * (`mcp__plugin_<marketplace>_<plugin>__create_issue`) -- both end in
 * `__<action>`, which is all any caller here needs. Returns `null` for a
 * non-MCP tool name (e.g. `Bash`) or a malformed one with no second `__`. */
export function mcpAction(toolName) {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null;
  const idx = toolName.lastIndexOf('__');
  if (idx <= 4) return null;
  return toolName.slice(idx + 2);
}
