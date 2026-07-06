---
id: 966a06c2-977e-4646-9329-d5a890002b88
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Read a project board with get_project_items
diataxis_type: how-to
---


Goal: list every item on a Projects v2 board along with its field values,
to find an item's node ID or inspect board state.

## Prerequisites

- You know the project's owner login, number, and owner type.
- No `project` scope check is performed by this tool itself (it's a read);
  a token without at least read access to the project will fail at the API
  call.
- This tool fetches at most the board's first 100 items in a single,
  unpaginated GraphQL query. A board with more than 100 items silently
  returns only the first 100 — there is no cursor or `hasNextPage` signal
  to detect the truncation.

## Steps

1. Call `get_project_items`:

   ```json
   { "projectOwnerLogin": "your-org", "projectNumber": 1 }
   ```

2. Read the response:

   ```json
   {
     "items": [
       {
         "id": "PVTI_...",
         "title": "Fix flaky upload retry",
         "number": 101,
         "repo": "your-org/your-repo",
         "fieldValues": [{ "fieldName": "Status", "optionName": "In Progress" }]
       }
     ]
   }
   ```

## Verify it worked

- Cross-check a few items' `title`/`number` against what you see on the
  board in the browser.
- If the board holds items from more than one repository, always match
  items by **both** `number` and `repo`, not `number` alone — two repos on
  the same board can share an issue number, and `number` alone is not a
  safe join key.
- A `DraftIssue` item has `number: null` and `repo: null` — it has neither.

See also: [tool reference](../reference/tools.md#get_project_items).
