---
id: 5a9d3e7c-2f6b-4e14-9d7a-3b6c8f2e5a48
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Put a PR on a Projects v2 board with add_pull_request_to_project
diataxis_type: how-to
---
# Put a PR on a Projects v2 board with `add_pull_request_to_project`

Add a pull request itself (not the issue it closes) as an item on a
Projects v2 board.

## Prerequisites

- `github-pull-requests` installed (this call reuses
  `github-sdlc-planning`'s project-resolution logic).
- The project board's owner login and project number.
- A classic token needs the `project` OAuth scope
  (`gh auth login --scopes project`); the call asserts this scope before
  doing anything else.

## Steps

1. Identify `projectOwnerLogin` (the org or user that owns the board) and
   `projectNumber`.
2. Call `add_pull_request_to_project`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "pullNumber": 12,
     "projectOwnerLogin": "your-org",
     "projectNumber": 1,
     "projectOwnerType": "organization"
   }
   ```

   `projectOwnerType` defaults to `organization` if omitted.
3. Read the response: `{ itemId: string }`.

## Verify it worked

Open the project board and confirm the PR appears as an item, or note the
returned `itemId` for a later `set_field_value` call (from
`github-sdlc-planning`) against that item.

## Notes

- This call has no built-in idempotency check: calling it again for a PR
  already on the board can add a duplicate item. Check the board first if
  re-adding the same PR is a real possibility.
- A missing `project` scope fails with `missing_scope`, not a generic API
  error — this is checked up front, before any GraphQL call runs.
- If project resolution itself fails (bad owner login or project number),
  the call fails with `resolve_id_failed`.
