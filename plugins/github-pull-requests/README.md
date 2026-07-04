---
id: 25a40c7f-52a4-4b36-bc2d-9a21f5786b43
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/github-pull-requests
modified: 2026-07-03T00:00:00Z
title: github-pull-requests
diataxis_type: reference
---
# github-pull-requests

Full pull-request lifecycle control — create, classify (type/size/risk
labels), review-route, link to issues, and couple to Projects v2 — not just
review-request routing. Depends on `github-sdlc-planning` — installing this
plugin auto-installs it.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-pull-requests@github-sdlc-plugins
```

Installing `github-pull-requests` alone resolves and installs
`github-sdlc-planning` as a dependency automatically. Disabling
`github-sdlc-planning` while `github-pull-requests` is enabled is refused —
disable both together, in the order the CLI's error message gives you.

## Auth

Same PAT `github-sdlc-planning` already requires — `repo` + `read:org` +
`project` scope, shared token/session serves both plugins. The `project`
scope is required for `add_pull_request_to_project` and
`sync_linked_issues_project_field` (checked via `assertProjectScope`, same
as the sibling package's Projects v2 writes); App installation tokens and
fine-grained PATs skip that check and rely on the actual GraphQL call to
surface a real permission error if access is genuinely missing.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_pull_request` | Open a PR via the GraphQL `createPullRequest` mutation |
| `classify_pull_request` | Apply `type:`/`size:`/`risk:` labels — size is computed automatically from the diff, same-category labels are replaced not accumulated |
| `request_review` / `list_review_requests` / `remove_review_request` | Reviewer routing |
| `get_linked_issues` | PR→issue link discovery: `closingIssuesReferences` first, Timeline-API/text-parsing fallback labeled `confidence: heuristic` |
| `add_pull_request_to_project` | Add a PR to a Projects v2 board via `addProjectV2ItemById` |
| `sync_linked_issues_project_field` | For a merged PR, set a Projects v2 field on every same-repo issue it closes — cross-repo closing issues are reported in `skippedCrossRepo`, never guessed at |

## Skill

- `pr-review-route` — CODEOWNERS-style reviewer suggestion, calls
  `request_review` on confirmation.

## Scope boundary

This plugin covers the full PR lifecycle (create, classify, review-route,
link, project-couple) plus reading/writing the specific Projects v2 field
values a caller names on a PR's linked issues after merge. It does not
create or triage issues itself, and does not decide which sprint/milestone
an issue belongs to, or discover a board's field/option IDs from scratch
(that's `github-sdlc-planning`'s job — its `set_field_value`/
`get_project_items` tools are the ones this plugin composes with).
