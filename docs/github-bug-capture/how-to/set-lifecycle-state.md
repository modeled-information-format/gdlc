---
id: 53da234b-55a4-45c0-bfee-65d0f7322d75
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Move a bug issue's board status (and optionally close it)
diataxis_type: how-to
---

Use this to move an issue's `Status` value on the triage board, and
optionally close the underlying issue in the same call.

## Prerequisites

- The board already has a `Status` field with the option you want to set.
  This tool looks the field up by name and never creates it — unlike
  `Severity`, there is no `ensure_status_field` tool. If the board has no
  `Status` field or lacks the option you want, add it manually on the
  board's Projects v2 settings.
- The issue is already an item on that board.

## Steps

1. Call, without closing the issue:

   ```text
   set_lifecycle_state {
     owner: "<owner>",
     repo: "<repo>",
     issueNumber: <n>,
     projectOwnerLogin: "<org-or-user>",
     projectNumber: <n>,
     status: "In Progress"
   }
   ```

   `status` must match an existing option name on the board's `Status`
   field exactly.

2. To also close the issue once its status reaches a terminal value (for
   example your board's "Done"), add `closeIfDone`:

   ```text
   set_lifecycle_state {
     owner: "<owner>",
     repo: "<repo>",
     issueNumber: <n>,
     projectOwnerLogin: "<org-or-user>",
     projectNumber: <n>,
     status: "Done",
     closeIfDone: true
   }
   ```

   This tool does not infer which Status values are terminal from their
   name — `closeIfDone: true` always closes the issue via REST PATCH after
   the Status write succeeds, regardless of which `status` string you
   passed. Only set it on the call where you actually mean to close the
   issue.

3. Handle known failure codes: `missing_scope` (the token lacks the
   `project` OAuth scope required for this Projects v2 mutation),
   `issue_not_on_board`, `missing_field` (no `Status` field on the board),
   `missing_option` (no option matching your `status` string — the error's
   `available` list shows valid options).

## Notes

- If your org project has GitHub's built-in Projects v2 workflows enabled
  (Item added / Item closed / Pull request merged, etc.), Todo-on-add and
  Done-on-close-or-merge may already happen natively without any call to
  this tool — see
  [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md), which
  governs that native automation (it lives in `github-sdlc-planning`, not
  this plugin). Call `set_lifecycle_state` explicitly for transitions native
  automation doesn't cover, such as marking In Progress.

## See also

- [how-to/get-lifecycle-state.md](get-lifecycle-state.md) — read-only check
  of the same data.
- [reference/tools.md](../reference/tools.md#set_lifecycle_state) — full
  input schema and error codes.
