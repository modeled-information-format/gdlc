---
id: 8b5d1e73-6a2f-4c08-b9d4-2f7e9a1c6d52
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Plan and track work with the planning and PR plugins
diataxis_type: how-to
---
# Plan and track work with the planning and PR plugins

Run a plan-to-merge cycle: decompose a goal into issues, board them, open
and classify the PR, and let linkage close the loop. Assumes Claude Code
with this marketplace added (root [README](../../README.md#quick-start))
and `github-pull-requests` installed (which brings `github-sdlc-planning`).

## 1. Decompose a goal into issues

Ask for the **epic-decomposition** skill with your goal. It files an Epic
and its Story/Task children as real GitHub sub-issues (native hierarchy,
not task-list checkboxes), each body carrying the MIF comment block
(`mif-id`/`mif-type`/`mif-ns`) so downstream tooling can read what each
issue *is*. Under the hood: `create_issue` + `add_sub_issue`; use those
tools directly for one-off issues. Progress on a parent is visible via
`list_sub_issues` (total/completed/percent).

## 2. Put work on the board

- New issues are auto-added with Status Todo when the org project has
  GitHub's built-in workflows enabled, as this org's board does
  ([ADR-0003](../decisions/adr-0003-board-status-hygiene.md)).
- For a board without auto-add, `add_item_to_project` places an issue
  explicitly; it is idempotent and returns the existing item rather than
  creating a duplicate when the issue is already there.
- Set any single-select/text/number/date/iteration field with
  `set_field_value`; read the board with `get_project_items`.
- Milestones: `create_milestone`, `assign_milestone`, `list_milestones`;
  the **milestone-triage** skill flags overdue/empty/stale ones, and
  **sprint-plan** fills an iteration from the backlog.
- Board bootstrap from nothing: the **project-setup** skill (or
  **template-gallery** for the curated Sprint/OKR/Bug-Triage/Feature
  layouts).

## 3. Mark work In Progress automatically

Configure once per consuming project in
`.claude/github-sdlc-planning.local.md` (keep out of version control):

```markdown
---
board:
  projectOwnerLogin: <org-or-user>
  projectNumber: <n>
---
```

With that in place, starting work through the tools (adding a sub-issue,
updating an open issue) moves the affected item to In Progress when its
Status is unset or Todo. Done needs nothing: the native workflows set it
on close/merge.

## 4. Open, classify, and route the PR

From `github-pull-requests`:

- `create_pull_request` opens the PR via GraphQL.
- `classify_pull_request` applies `type:`/`size:`/`risk:` labels; size is
  computed from the diff.
- The **pr-review-route** skill suggests reviewers and requests them on
  your confirmation.
- `add_pull_request_to_project` puts the PR itself on a board.

Write `Fixes #N`/`Closes #N` in the PR body so the merge closes the issue
natively.

## 5. Close the loop after merge

- `get_linked_issues` reads which issues a PR closes (with retry, since
  GitHub populates the linkage asynchronously).
- `sync_linked_issues_project_field` stamps a board field (a "Shipped in"
  iteration, a release column) across every issue the merged PR closed,
  matching items by repo and number so multi-repo boards stay correct.
- The board's Done transition happens natively on close; nothing to call.

## Working outside Claude Code

Every write above goes through the portable MCP servers, so any MCP host
drives the same flow; `get_session_context` replaces the SessionStart hook
for context, and `get_agent_capabilities` is the feature-detection entry
point. See [Verify cross-agent portability](verify-cross-agent.md).
