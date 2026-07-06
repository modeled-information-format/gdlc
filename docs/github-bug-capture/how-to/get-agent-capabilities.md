---
id: c9d99db0-c7e6-4b62-bd2e-59a160225f0d
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Detect what github-bug-capture supports
diataxis_type: how-to
---

Use this when an MCP host, orchestrating agent, or sibling plugin needs to
confirm this server is reachable and discover its tool surface and sibling
dependencies without probing each tool individually.

## Steps

1. Call the tool with no arguments:

   ```text
   get_agent_capabilities
   ```

2. Read the response:

   ```json
   {
     "plugin": "github-bug-capture",
     "tools": [
       "get_agent_capabilities",
       "ensure_severity_field",
       "set_severity",
       "get_lifecycle_state",
       "set_lifecycle_state",
       "search_similar_issues",
       "close_as_duplicate"
     ],
     "mifConformance": "L1",
     "composesWith": ["github-pull-requests", "github-sdlc-planning"],
     "hooksSupported": true
   }
   ```

3. Branch on `tools` if you need to feature-detect before calling a specific
   tool (useful when talking to a version of this server that might predate
   a given tool).

4. Use `composesWith` to confirm the sibling plugins this server expects —
   per [ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md),
   PR-linkage calls belong to `github-pull-requests`, not this server.

## See also

- [reference/tools.md](../reference/tools.md) for the full schema of every
  listed tool.
