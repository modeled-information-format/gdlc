---
id: 5e8b2d4a-9f1c-4a76-b3e8-6c2d7f4a1b95
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-pull-requests exists
diataxis_type: explanation
related:
  - adr-0002-pr-issue-linkage-ownership.md
---

## Role in the PR lifecycle

`github-pull-requests` owns the full mechanics of a pull request from open to
merge: creating it (`create_pull_request`), classifying it with type/size/risk
labels (`classify_pull_request`), routing reviewers
(`request_review`/`list_review_requests`/`remove_review_request`), reading
which issues it closes (`get_linked_issues`), and coupling it to a Projects v2
board (`add_pull_request_to_project`, `sync_linked_issues_project_field`).
This is the "PR-domain" plugin in the marketplace: everything here reads or
mutates a pull request itself, not the issue or board state that a PR merge
eventually reconciles.

The plugin's own manifest (`.claude-plugin/plugin.json`) states this
directly: "Full pull-request lifecycle control: create, classify (type/size/
risk labels), review-route, link to issues, and couple to Projects v2."

## Dependency on github-sdlc-planning

`github-pull-requests` declares a same-marketplace `dependencies` edge on
`github-sdlc-planning` and reuses two things from it rather than duplicating
them:

- **The shared MIF comment-block reader** (`parseMifIssueBody`), used by
  `get_linked_issues` to set `alreadyTracked` on each linked issue — whether
  the target issue already carries a `github-sdlc-planning` MIF identity
  block, so a caller doesn't re-synthesize it as a new planning unit.
- **Projects v2 machinery** (`resolveProjectNodeId`, `getProjectItems`,
  `setFieldValue`), used by `add_pull_request_to_project` and
  `sync_linked_issues_project_field` — the org/user project branching logic
  and field-value discriminated union live in the planning plugin and are
  imported here, not reimplemented.

Both consuming tools wrap the planning plugin's errors (`PlanningError`) into
this plugin's own `PrError` shape before they can escape, preserving
meaningful codes (`missing_scope`, `github_api_error`, `rate_limited`) rather
than collapsing every planning-side failure into a generic one. This keeps a
caller's error handling uniform regardless of which plugin's tool raised the
failure.

## ADR audit

ADRs relevant to this plugin's own tools, decisions, or boundaries:

| ADR | Title | Relevance |
| --- | --- | --- |
| [ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md) | PR-to-Issue Linkage Stays in github-pull-requests; github-bug-capture Consumes It | Directly decides this plugin's boundary: `get_linked_issues` and `sync_linked_issues_project_field` are the single linkage implementation in the marketplace, consumed by `github-bug-capture` through a dependency edge rather than being duplicated there. |
| ADR-0001 | MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1 | Decides `github-bug-capture`'s own Layer 1 architecture (MCP-server core vs. gh-CLI-wrapper-first). Does not make a decision about this plugin's own tools — relevant only as background for why `github-bug-capture` is the consumer named in ADR-0002. |
| ADR-0003 | Board-status hygiene relies on native Projects v2 workflows | Decides board Todo/Done semantics for the org project generally. Does not make a decision specific to this plugin's tools; `add_pull_request_to_project` and `sync_linked_issues_project_field` operate on top of whatever board-status behavior ADR-0003 establishes, but the ADR itself is scoped to the planning/bug-capture side of the board, not to this plugin. |

Only ADR-0002 makes a decision specifically about this plugin's own tool
surface; ADR-0001 and ADR-0003 are noted for completeness but scoped
elsewhere.
