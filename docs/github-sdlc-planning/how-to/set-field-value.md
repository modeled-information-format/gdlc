---
id: 8e4dee8e-177e-4548-9ec2-abe56b9f82ab
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Set a project field value with set_field_value
diataxis_type: how-to
---

# Set a project field value with `set_field_value`

Goal: set a Projects v2 item's field (Status, an iteration, a custom text or
number field) to a specific value.

## Prerequisites

- A `project`-scoped token, same requirement as `add_item_to_project`.
- The item's node ID — from [`add_item_to_project`](add-item-to-project.md)'s
  result or from [`get_project_items`](get-project-items.md).
- The field's node ID — from a field-listing query or from the project
  settings UI's API view; this tool does not resolve a field name to an ID
  for you.
- Before setting a Status field by hand, check whether GitHub's native
  Projects v2 workflows already handle the transition you want — see
  [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md). Manually
  setting Todo/Done on a board that has auto-add/auto-close workflows
  enabled duplicates what the platform already does and can race it.

## Steps

1. Pick the `value` shape matching the field's type:

   | Field type | `value` |
   | --- | --- |
   | Text | `{ "kind": "text", "text": "..." }` |
   | Number | `{ "kind": "number", "number": 3 }` |
   | Date | `{ "kind": "date", "date": "2026-08-01" }` |
   | Single select (e.g. Status) | `{ "kind": "singleSelect", "optionId": "..." }` |
   | Iteration | `{ "kind": "iteration", "iterationId": "..." }` |

2. Call `set_field_value`:

   ```json
   {
     "projectOwnerLogin": "your-org",
     "projectNumber": 1,
     "itemId": "PVTI_...",
     "fieldId": "PVTF_...",
     "value": { "kind": "singleSelect", "optionId": "..." }
   }
   ```

3. Read the response: `{ itemId }`.

## Verify it worked

- Reload the project board and confirm the item's field shows the new
  value.
- Call [`get_project_items`](get-project-items.md) and check that the
  item's `fieldValues` array now includes the updated field.

See also: [tool reference](../reference/tools.md#set_field_value).
