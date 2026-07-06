---
id: 43bcc71f-ff56-4de4-8ce3-4d3b9229b640
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Provision the Severity field on a triage board
diataxis_type: how-to
---

Use this once per Projects v2 board, before calling `set_severity` against
any issue on it, to make sure the board has a `Severity` single-select
field with the canonical options.

## Steps

1. Identify the board's owner login, project number, and owner type
   (`organization` is the default if you omit `projectOwnerType`).

2. Call:

   ```text
   ensure_severity_field {
     projectOwnerLogin: "<org-or-user>",
     projectNumber: <n>,
     projectOwnerType: "organization"
   }
   ```

3. Check the response:

   - `created: true` — the field did not exist; it was created with options
     `Critical` (red), `High` (orange), `Medium` (yellow), `Low` (green).
   - `created: false` — the field already existed; it was returned as-is,
     with no mutation. `options` still lists the current option IDs.

4. If the call instead fails with `field_type_conflict`, a field named
   `Severity` already exists on the board but is not a single-select field
   (for example, a text or number field). Rename or remove that field on
   the board before retrying — this tool will not overwrite it.

## Notes

- This call is safe to run repeatedly (idempotent) and safe to include in
  setup automation without a pre-check.
- Projects v2 writes need the `project` OAuth scope on classic tokens
  (`gh auth login --scopes project`); a missing scope surfaces as a
  `missing_scope` error, not a silent failure.

## See also

- [how-to/set-severity.md](set-severity.md) — the next step, once the field
  exists.
- [reference/tools.md](../reference/tools.md#ensure_severity_field) — full
  input schema.
