---
id: cc2c4543-e494-4324-b504-c0340f3ef262
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Feature-detect the server with get_agent_capabilities
diataxis_type: how-to
---


Goal: discover this MCP server's full tool surface and MIF conformance
level at runtime, without hard-coding assumptions about which tools it
exposes or whether it depends on host hooks.

## Prerequisites

- None — the tool takes no parameters and makes no GitHub API call.

## Steps

1. Call `get_agent_capabilities` with an empty input.
2. Read the response:

   ```json
   {
     "tools": [
       "create_issue", "update_issue", "add_sub_issue", "list_sub_issues",
       "add_item_to_project", "set_field_value", "get_project_items",
       "create_milestone", "list_milestones", "assign_milestone",
       "create_discussion", "list_discussions",
       "format_mif_issue_body", "parse_mif_issue_body",
       "get_session_context", "get_agent_capabilities"
     ],
     "mifConformance": "L1",
     "hooksSupported": false
   }
   ```

## Verify it worked

- `tools` lists all 16 tool names registered by this server — use it to
  confirm your MCP host sees the full surface rather than a subset.
- `hooksSupported: false` is a fixed, documented signal that this MCP layer
  never relies on host lifecycle hooks: on a host with no `SessionStart`
  hook, call [`get_session_context`](get-session-context.md) explicitly
  instead of assuming context was injected automatically, and validate MIF
  conformance yourself via
  [`parse_mif_issue_body`](parse-mif-issue-body.md) rather than assuming a
  `validate-mif` hook already ran.

See also: [tool reference](../reference/tools.md#get_agent_capabilities).
