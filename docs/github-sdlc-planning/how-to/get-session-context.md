---
id: 4650826f-f0a4-41c4-a656-b4e1d47f8217
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Bootstrap session context with get_session_context
diataxis_type: how-to
---

# Bootstrap session context with `get_session_context`

Goal: fetch a repository's open milestones and, optionally, a Projects v2
board's state in one call — the equivalent of what Claude Code's
`session-start.mjs` hook injects automatically, for any MCP host that has no
such hook.

## Prerequisites

- Read access to the target repository and (if requesting board state) the
  target project.

## Steps

1. For milestones only:

   ```json
   { "owner": "your-org", "repo": "your-repo" }
   ```

2. For milestones plus board state, add the project fields:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "projectOwnerLogin": "your-org",
     "projectNumber": 1
   }
   ```

   `projectOwnerType` defaults to `organization`; pass `"user"` for a
   user-owned project.

3. Read the response: `{ openMilestones: [...], projectBoard: {...} |
   null }`.

## Verify it worked

- `openMilestones` matches [`list_milestones`](list-milestones.md) called
  with `state: "open"`.
- `projectBoard` is `null` unless you supplied **both**
  `projectOwnerLogin` and `projectNumber` — supplying only one still
  returns `null` for `projectBoard`, it does not error.
- When non-null, `projectBoard` has the same shape as
  [`get_project_items`](get-project-items.md)'s result.

See also: [tool reference](../reference/tools.md#get_session_context).
