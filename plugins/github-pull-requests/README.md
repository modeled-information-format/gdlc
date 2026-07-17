---
id: 25a40c7f-52a4-4b36-bc2d-9a21f5786b43
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/github-pull-requests
modified: '2026-07-17T12:48:08.714Z'
title: github-pull-requests
diataxis_type: reference
provenance:
  '@type': Provenance
  agent: claude-code/claude-sonnet-5
  wasGeneratedBy:
    '@id': urn:mif:activity:claude-code-session:510bf739-31a0-4ce7-a88a-aa51484ddbbd
    '@type': prov:Activity
  trustLevel: user_stated
  agentVersion: 2.1.212
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
| `check_pr_readiness` | issue #185/#188: single settled/not-settled verdict combining status checks, review state, review-thread resolution, and code-scanning alerts. Consults `prLifecycle.requireCleanCodeScanning` from `.config/gdlc/config.yml` (`false` skips the code-scanning check entirely, including the fetch) — the only `prLifecycle` toggle this tool reads; `requireLocalReview`/`requireCopilotReview` govern the hooks above, not this tool. Also available as `npm run pr-readiness -- <owner> <repo> <pullNumber>`, a CLI script meant to be called by name from a Monitor poll loop instead of hand-rolled `gh api`/`jq` |

## Skill

- `pr-review-route` — CODEOWNERS-style reviewer suggestion, calls
  `request_review` on confirmation.

## PR-lifecycle enforcement (issue #185)

Opt-in via `.config/gdlc/config.yml`'s `prLifecycle` section (see
[the config schema reference](../../docs/reference/config-schema.md#pr-lifecycle-enforcement-issue-185));
fail-closed, off by default. Two hooks read it, both dependency-free
(`hooks/lib/pr-lifecycle-config.mjs`, a from-scratch re-implementation of
the same path-resolution/section-parsing pattern `github-sdlc-planning`'s
`hooks/lib/in-progress.mjs`/`settings.mjs` use — deliberately not shared
across the plugin boundary, matching this codebase's existing convention):

| Hook | Event / matcher | What it does |
| --- | --- | --- |
| `pr-lifecycle-gate.mjs` | `PreToolUse`, `create_pull_request` only | When `requireLocalReview`, surfaces a reminder naming the configured `localReviewer` command — non-blocking (`permissionDecision: 'allow'`) unless `confirmLocalReview: true`, which restores a hard `'ask'` confirmation. |
| `pr-lifecycle-reminder.mjs` | `PostToolUse`, `create_pull_request` only | When `requireCopilotReview`, reminds the agent to call `request_review` with Copilot immediately. |

`review-thread-gate.mjs` (`PreToolUse`, worktree/branch creation) has the
same shape: when `gateNewWorkOnUnresolvedThreads` flags a session-opened PR
with unresolved review threads, it's a non-blocking reminder unless
`confirmNewWorkGate: true`. `confirmLocalReview`/`confirmNewWorkGate`
(issue #275) both default `false` — same opt-out shape as
`packs.skipMutationConfirm` — separating "does this check run" from "does
tripping it block the tool call."

**Neither hook can execute `localReviewer` itself.** A Claude Code hook can
only spawn an OS process (`node`/`bash`); it has no mechanism to invoke a
slash command or skill, and `localReviewer`'s default
(`/code-review --fix`) is exactly that. `pr-lifecycle-gate.mjs`
surfaces the command as an instruction the *agent* must act on — the same
legible-confirmation pattern `github-sdlc-planning`'s `confirm-mutation.mjs`
already uses for board mutations — it does not, and cannot, run local
review on your behalf. Don't read "gate" here as "enforced by the hook
sandbox"; read it as "the agent is told, loudly, before it can proceed
silently."

Note the default is bare `/code-review` (Claude Code's native, current-diff
review command, which can run before a PR exists) — not the plugin-qualified
`/code-review:code-review`. That qualified name resolves to the separate
`code-review@claude-plugins-official` marketplace plugin, which is
PR-fetch-only (`gh pr diff`/`gh pr view`) and has no `--fix` handling; it
cannot satisfy this pre-PR gate at all.

Once a PR is open, `check_pr_readiness` (below) is the single source of
truth for "is this PR actually ready" — checks, review state, review-thread
resolution, and code-scanning alerts together, not just one of them.

## Scope boundary

This plugin covers the full PR lifecycle (create, classify, review-route,
link, project-couple) plus reading/writing the specific Projects v2 field
values a caller names on a PR's linked issues after merge. It does not
create or triage issues itself, and does not decide which sprint/milestone
an issue belongs to, or discover a board's field/option IDs from scratch
(that's `github-sdlc-planning`'s job — its `set_field_value`/
`get_project_items` tools are the ones this plugin composes with).
