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

PR review-request routing and PR-to-issue link visibility. Depends on
`github-sdlc-planning` — installing this plugin auto-installs it.

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

Same PAT/`repo` scope `github-sdlc-planning` already requires — no additional
scope, shared token/session serves both plugins.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `request_review` / `list_review_requests` / `remove_review_request` | Reviewer routing |
| `get_linked_issues` | PR→issue link discovery: `closingIssuesReferences` first, Timeline-API/text-parsing fallback labeled `confidence: heuristic` |

## Skill

- `pr-review-route` — CODEOWNERS-style reviewer suggestion, calls
  `request_review` on confirmation.

## Scope boundary

This plugin surfaces and manages PR review/link state; it does not create or
triage issues, and does not decide which sprint/milestone an issue belongs to
(that's `github-sdlc-planning`'s job).
