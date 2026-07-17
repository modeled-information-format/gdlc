---
description: Fan out over a GitHub issues/PR search query and drive every item it returns to a settled pull request — issues get developed into PRs, existing PRs enter at review, and each PR is code-reviewed with fixes applied, Copilot-reviewed (one round, threads resolved), and CI-green before it is optionally squash-merged or handed off for human merge. Use when the user gives a query ("everything labeled tech-debt", "all open Dependabot PRs") and wants each result delivered independently. Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "run the query pipeline", "sweep this query", "deliver everything matching <query>", "work every issue labeled X to a merged PR", or when a GitHub search query needs each of its results developed, reviewed, and settled as its own PR rather than decomposed into one plan.
argument-hint: "[owner/repo] <search query> [--automerge] [--max-items N]"
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion, Workflow, ToolSearch, mcp__github-sdlc-planning__*, mcp__plugin_github-sdlc-planning_github-sdlc-planning__*, mcp__github-pull-requests__*, mcp__plugin_github-pull-requests_github-pull-requests__*, mcp__github-bug-capture__*, mcp__plugin_github-bug-capture_github-bug-capture__*, mcp__github-repo-config__*, mcp__plugin_github-repo-config_github-repo-config__*
---

# Query pipeline

Turn **$ARGUMENTS** into a fleet of independently settled pull requests: one
GitHub issues/PR search query in, one delivered PR per result out. Where
`epic-pipeline` decomposes a single goal into a hierarchy that ships as one
PR, this skill is its fan-out counterpart — every query result is its own
unit of work with its own branch, PR, review loop, and settle verdict. The
orchestration itself runs as a background Workflow from the bundled script
at `${CLAUDE_PLUGIN_ROOT}/skills/query-pipeline/scripts/query-pipeline.workflow.js`
(plugins cannot ship named workflows, so this skill launches the script by
path). See `../epic-pipeline/references/gdlc-native-mechanics.md` for the
plugin tool inventory the per-item agents compose.

## Phase 0 — Resolve the run's parameters, then launch exactly once

The Workflow runs in the background where no user interaction is possible,
so **every decision must be resolved before launch**. Gather these, asking
via AskUserQuestion for anything missing or ambiguous — never guess:

1. **The query** (required). A GitHub search expression
   (`is:issue is:open label:tech-debt`, `is:pr is:open author:app/dependabot`,
   a plain-text search, or a URL). If `$ARGUMENTS` has no recognizable
   query, ask for one. If the query names no repo/org qualifier and no
   `owner/repo` argument was given, resolve the current repo from
   `gh repo view --json nameWithOwner` and confirm that scope with the user
   rather than silently searching all of GitHub.
2. **`--automerge`** (default: off). Merging is consequential: only treat it
   as on when the flag was explicitly passed or the user explicitly said to
   merge. When unspecified and the user's phrasing suggests they may want
   merges ("ship all of these"), ask — one question, two options
   (automerge settled PRs / leave every settled PR for human merge).
   Never infer automerge from silence.
3. **`--max-items N`** (default: 10). The cap on how many query results one
   run processes. If the query returns more than N, the workflow logs
   exactly what was dropped — surface that list in the final report.
4. **Auth preflight**: call `github-sdlc-planning`'s `get_agent_capabilities`
   (name the plugin — the tool name exists in more than one) so a
   `missing_scope` failure surfaces now, not mid-fleet after branches
   already exist.

Then launch **one** Workflow call:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/query-pipeline/scripts/query-pipeline.workflow.js",
  args: { query, automerge, maxItems, defaultRepo, reviewModel }
})
```

`defaultRepo` is the resolved `owner/repo` scope (or null when the query
itself carries the scope). `reviewModel` defaults to `"opus"` — review
passes run on a model other than the session default so review is not the
author grading its own work; pass a different override only if the user
names one.

## What the workflow does per item (for the record — the script encodes it)

- **Discover**: one agent runs the query via `gh search issues` /
  `gh search prs`, returns structured items, and the script caps at
  `maxItems`, logging every dropped item.
- **Develop** (issues only — existing PRs skip straight to Review): an agent
  reads the issue, implements it in an isolated temporary worktree (never a
  possibly-dirty primary checkout), runs the repo's own local gates, pushes,
  opens the PR via `create_pull_request` (never `gh pr create`) with
  `Closes #N`, classifies it, puts it on the board, and moves the issue's
  board Status forward with a comment at each transition.
- **Review**: `/code-review:code-review <PR> --fix --no-comments` on
  `reviewModel`; fixes are pushed, findings never posted as a PR comment.
- **Settle**: request a Copilot review **once** via
  `github-pull-requests`' `request_review` (verified with
  `list_review_requests` — the request can silently no-op), wait for the
  review to land against the PR's current head SHA, fix every finding,
  resolve every review thread, then poll `check_pr_readiness` until it
  reports `settled: true` (its verdict already combines checks, review
  state, thread resolution, and code-scanning alerts). **One Copilot round
  is the hard cap** — after its findings are fixed and threads resolved, a
  second request is never issued.
- **Merge** (only when `automerge` was resolved on in Phase 0): squash-merge
  the settled PR, then `sync_linked_issues_project_field` for the
  post-merge board fields and confirm linked-issue closure via
  `get_linked_issues`. Without automerge, the settled PR is left open and
  reported as ready for human merge.

## Phase 1 — Report

When the workflow returns, report one row per item: source issue/PR, its
disposition (developed / entered-at-review / dropped-over-cap / failed),
the PR URL, the final `check_pr_readiness` verdict, and merged vs.
waiting-for-human-merge. Anything that failed or never settled is listed
with why and what its board Status was left as — never silently dropped.

## Constraints (always)

- One Copilot review round per PR, ever. A silently no-op'd request is not
  a reason to retry past the cap.
- Never merge any PR unless automerge was explicitly resolved on in
  Phase 0. CI green plus review settled is readiness, not authorization.
- Compose plugin tools (`create_pull_request`, `classify_pull_request`,
  `check_pr_readiness`, `set_field_value`, `sync_linked_issues_project_field`)
  — a hand-rolled `gh api graphql` call is acceptable only where no plugin
  tool covers the operation (e.g. `resolveReviewThread`).
- Board Status moves forward with a comment at every transition, and is
  read before it is written — native Projects v2 automations may already
  have moved it.
- Never add an AI-attribution trailer to any commit, PR, issue, or comment.
- Bugs discovered mid-implementation go through the `file-bug` skill, never
  a hand-rolled `create_issue`.
- If the query is ambiguous about scope or intent, ask before launching —
  a background fleet cannot ask later.
