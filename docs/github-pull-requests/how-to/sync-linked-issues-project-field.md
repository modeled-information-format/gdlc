---
id: 1e5f8b3d-7a2c-4f96-b8e3-4d7a9c1f5b26
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Stamp a board field on closed issues with sync_linked_issues_project_field
diataxis_type: how-to
---
# Stamp a board field on closed issues with `sync_linked_issues_project_field`

After a pull request merges, propagate a Projects v2 field value (e.g. a
"Shipped in" iteration or release column) onto every same-repo issue it
closed.

## Prerequisites

- `github-pull-requests` installed.
- The pull request must already be **merged** — this call checks and fails
  otherwise.
- The board's `fieldId` and the field's expected value shape (see below).

## Steps

1. Confirm the PR is merged.
2. Identify the target field's `fieldId` and its value `kind` (`text`,
   `number`, `date`, `singleSelect`, or `iteration`) — read these from
   `github-sdlc-planning`'s board tools if you don't already have them.
3. Call `sync_linked_issues_project_field`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "pullNumber": 12,
     "projectOwnerLogin": "your-org",
     "projectNumber": 1,
     "fieldId": "PVTF_lADOexample",
     "value": { "kind": "text", "text": "2026-Q3" }
   }
   ```

4. Read the response:

   ```json
   {
     "synced": [{ "issueNumber": 42, "itemId": "PVTI_lADOexample" }],
     "notFoundOnBoard": [],
     "skippedCrossRepo": []
   }
   ```

## Verify it worked

Check `synced` lists every issue you expected the field update to reach.
Investigate `notFoundOnBoard` (issue exists, closing reference found, but no
matching board item — possibly outside the board's first 100 items) and
`skippedCrossRepo` (a closing issue in a different repository than the PR,
intentionally never guessed at) before assuming the sync is complete.

## Notes

- Fails with `not_merged` if the PR is not merged yet — there is no "dry
  run" or "preview" mode.
- Issue-to-board-item matching uses both repo and issue number, not number
  alone, so a same-numbered issue in an unrelated repo on the same board is
  never mismatched.
- `get_project_items` (the underlying planning-plugin call this uses) is
  unpaginated at `first: 100`; a board larger than that can under-report
  `synced` and over-report `notFoundOnBoard` for items genuinely on the
  board but outside the first page.
- Cross-repo closing issues are always reported in `skippedCrossRepo`, never
  written to — even if you know the correct board item, this call will not
  update it.
