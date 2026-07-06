---
id: 676029c9-3fc7-4d39-9dd8-63c7a25cb84e
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Set an issue's severity
diataxis_type: how-to
---

Use this to record how severe a bug issue is on its triage board's
`Severity` field.

## Prerequisites

- The board already has a `Severity` field — run
  [ensure_severity_field](ensure-severity-field.md) first if you haven't.
- The issue is already an item on that board (native Projects v2 auto-add
  workflows usually place it there shortly after filing).

## Steps

1. Call:

   ```text
   set_severity {
     owner: "<owner>",
     repo: "<repo>",
     issueNumber: <n>,
     projectOwnerLogin: "<org-or-user>",
     projectNumber: <n>,
     severity: "Critical" | "High" | "Medium" | "Low"
   }
   ```

2. On success you get back `{ itemId, fieldId, optionId, severity }`.

3. Handle known failure codes:

   - `missing_scope` — the token lacks the `project` OAuth scope required
     for this Projects v2 mutation.
   - `issue_not_on_board` — the issue isn't a project item yet. Wait for
     auto-add or add it explicitly via `github-sdlc-planning`'s tools, then
     retry.
   - `missing_field` — the board has no `Severity` field. Run
     [ensure_severity_field](ensure-severity-field.md) first.
   - `missing_option` — you passed a severity string that doesn't match one
     of the field's option names exactly; the error's `available` list shows
     the valid options.

## See also

- [reference/tools.md](../reference/tools.md#set_severity) — full input
  schema and error codes.
- [how-to/get-lifecycle-state.md](get-lifecycle-state.md) — to check an
  issue's status alongside its severity.
