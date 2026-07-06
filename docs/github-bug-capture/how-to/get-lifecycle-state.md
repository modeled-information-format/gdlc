---
id: 7da254ef-132e-47f9-b6b4-1b1627ae0b58
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Check a bug issue's lifecycle state
diataxis_type: how-to
---
# Check a bug issue's lifecycle state

Use this to read where a bug issue stands — combining GitHub's native
open/closed state with the triage board's `Status` value — without mutating
anything.

## Steps

1. Call:

   ```text
   get_lifecycle_state {
     owner: "<owner>",
     repo: "<repo>",
     issueNumber: <n>,
     projectOwnerLogin: "<org-or-user>",
     projectNumber: <n>
   }
   ```

2. Read the response:

   ```json
   {
     "issueNumber": 142,
     "nativeState": "open",
     "onBoard": true,
     "status": "In Progress"
   }
   ```

   - `nativeState` is GitHub's own `open`/`closed`, independent of the
     board.
   - `onBoard: false` means the issue isn't a project item on the board you
     specified; `status` will be `null` in that case.
   - `status: null` with `onBoard: true` means the issue is on the board but
     its `Status` field has no value set. Neither case is an error — this
     tool never throws for a missing board membership or Status value.

## Notes

- If you need a hard failure instead of a null on a missing board/field
  (for example, before a write), use
  [set_lifecycle_state](set-lifecycle-state.md) instead — it resolves the
  same data but must throw a typed error when it can't proceed.

## See also

- [reference/tools.md](../reference/tools.md#get_lifecycle_state) — full
  input/output schema.
