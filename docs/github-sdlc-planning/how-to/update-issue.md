---
id: a5264175-6f68-4228-a3f6-7e1828e66e17
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Update an issue with the update_issue tool
diataxis_type: how-to
---


Goal: change an existing issue's title, body, open/closed state, or
organization issue type.

## Prerequisites

- The issue already exists; you know its `owner`, `repo`, and `number`.
- If setting `issueType`, it must be one of the organization's defined issue
  types.

## Steps

1. Call `update_issue` with only the fields you want to change — omitted
   fields are left untouched:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "number": 101,
     "state": "closed"
   }
   ```

2. To relabel an issue's type:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "number": 101,
     "issueType": "Bug"
   }
   ```

   The tool looks up `"Bug"` against the organization's `issueTypes` first
   and throws `unknown_issue_type` (naming the available types) before
   calling the API if it doesn't exist — it never sends an invalid type to
   GitHub.

3. Read the response: `{ number, url }`.

## Verify it worked

- Reload the issue at the returned `url` and confirm the title/body/state/
  type reflects your change.
- If you also use `github-sdlc-planning`'s `set-in-progress` hook and this
  update did not set `state: "closed"`, the issue's board item (if
  configured) may move to In Progress — see
  [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md). Closing an
  issue is treated as a completion signal, not a start-of-work one, so it
  never triggers that hook.

See also: [tool reference](../reference/tools.md#update_issue).
