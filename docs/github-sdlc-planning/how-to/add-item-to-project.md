---
id: 9ce29b23-9f4a-42fa-affd-257df1380841
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Put an issue on a project board with add_item_to_project
diataxis_type: how-to
---


Goal: add an issue to a Projects v2 board, without creating a duplicate item
if it's already there.

## Prerequisites

- A classic OAuth-scoped GitHub token (`ghp_`/`gho_`) needs the `project`
  scope (`gh auth login --scopes project`). GitHub App installation tokens
  and fine-grained PATs skip this pre-check and rely on the API call itself
  to fail if access is genuinely missing.
- You know the project's owner login, number, and owner type
  (`organization` or `user`).
- The issue already exists.

## Steps

1. Call `add_item_to_project`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "issueNumber": 101,
     "projectOwnerLogin": "your-org",
     "projectNumber": 1
   }
   ```

   Omit `projectOwnerType` for an organization-owned project; pass
   `"projectOwnerType": "user"` for a user-owned one.

2. Read the response: `{ itemId, existed }`.

## Verify it worked

- If `existed: false`, this call created a new item — reload the project
  board and confirm the issue appears.
- If `existed: true`, the issue already had an item on this project (for
  example, a native `Auto-add to project` workflow added it the moment the
  issue was created) and the tool returned that item's ID instead of
  creating a second one. This is the documented behavior from
  [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md) — before
  this plugin's own tools call anything, check whether the board already
  has native automation covering this, since a duplicate `addProjectV2ItemById`
  call has no idempotency key on GitHub's side.
- A missing `project` scope surfaces as `{ error: "missing_scope",
  missingScope: "project", presentScopes: [...] }` before any mutation is
  attempted.

See also: [tool reference](../reference/tools.md#add_item_to_project).
