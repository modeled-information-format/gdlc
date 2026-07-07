---
id: 9a4e2c8f-3d6b-4a1e-8c9d-2f7b5e3a1d69
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: set up milestones and a project board for a new initiative"
diataxis_type: how-to
---

A new initiative is starting and needs its own tracking scaffolding: a
milestone (or a few, for planned phases) and its issues visible on a
Projects v2 board.
[The main tutorial](../tutorials/create-your-first-epic.md) focuses on
building the sub-issue hierarchy itself (`create_issue`, `add_sub_issue`,
`list_sub_issues`) — this guide covers the milestone and project-board
layer on top of that hierarchy, which the tutorial doesn't touch.

## Steps

1. **Create the milestone(s).** Milestones are REST-only (GitHub's GraphQL
   API only exposes them read-only), one call per milestone:

   ```text
   create_milestone {
     owner: "octo-org", repo: "widget-app",
     title: "Offline sync — Phase 1",
     dueOn: "2026-09-01T00:00:00Z"
   }
   ```

   Note the returned `number` — you'll assign issues to it by that number,
   not by title.

2. **Assign your Epic (and its Stories, if they map to the same phase) to
   the milestone:**

   ```text
   assign_milestone {
     owner: "octo-org", repo: "widget-app", issueNumber: 201, milestoneNumber: 7
   }
   ```

   Passing `null` for `milestoneNumber` unassigns an issue from whatever
   milestone it currently has — useful if a phase's scope changes and an
   issue needs to move to a different milestone later.

3. **Add the Epic (and its Stories) to your Projects v2 board.** If your
   org or repo already has a board mapping configured
   (`.config/gdlc/config.yml` or the global config), you can omit the
   project coordinates entirely:

   ```text
   add_item_to_project {
     owner: "octo-org", repo: "widget-app", issueNumber: 201
   }
   ```

   If nothing's configured, or you're targeting a different board than the
   default, pass `projectOwnerLogin`/`projectNumber` explicitly — both
   together, never just one (an incomplete pair throws
   `missing_board_config`). This call is idempotent: if a native GitHub
   auto-add workflow already put the issue on the board, you get back
   `existed: true` instead of a duplicate item.

4. **Set the board's Status (or any other field) for each item.** You need
   the field's node ID first. `get_project_items` won't give you this — it
   returns field *names* and values (`fieldName`, `optionName`), not node
   IDs. Get the actual `fieldId` (and the target `optionId`, for a
   single-select field) from the board's own GraphQL schema — an
   `organization(login:...) { projectV2(number:...) { field(name:...) {
   ... on ProjectV2SingleSelectField { id options { id name } } } } }`
   query against the GitHub API, run once per field you need:

   ```text
   set_field_value {
     itemId: "<itemId from step 3's response>",
     fieldId: "<the Status field's id>",
     value: { kind: "singleSelect", optionId: "<the target option's id>" }
   }
   ```

   `value`'s shape depends on the field type — `singleSelect` needs
   `optionId`, a text field needs `text`, a date field needs `date`, and so
   on. Match the shape to the field you're actually setting.

5. **Check the board's current state at any point** with
   `get_project_items` — it returns every item's field values in one call,
   useful for confirming your milestone/board setup landed the way you
   expect without opening the board in a browser.

## The `project` OAuth scope requirement

`add_item_to_project` and `set_field_value` both require a classic token
carrying the `project` scope — `gh auth login --scopes project` if you
haven't already. This check only applies to classic OAuth-scoped personal
access tokens; GitHub App installation tokens and fine-grained PATs skip
it (they're scoped a different way). If you get `missing_scope` here but
other calls in this guide worked fine, this is the specific scope to add.
