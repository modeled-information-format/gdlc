---
description: Decompose a GitHub issue, plan/design doc, or free-text goal into a native Epic/Story/Task hierarchy and carry it through to a reviewed, merged pull request — composing every github-sdlc-plugins tool (planning, PR lifecycle, bug capture, repo governance, insights, packages, org identity) instead of hand-rolled gh/GraphQL calls. Use when the user asks to "run the epic pipeline", "plan and build this epic", "turn this into a work plan and implement it", or "decompose and ship this". Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "run the epic pipeline", "plan and execute this epic end to end", "decompose this and build it", "turn this goal into issues and ship a PR", or when a seed issue/plan/goal needs full Epic-to-merged-PR delivery in a repo where the github-sdlc-plugins are installed.
argument-hint: "[owner/repo] [#issue | path/to/plan.md | free-text goal] [--plan-only | --execute]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, Workflow, ToolSearch, mcp__github-sdlc-planning__*, mcp__plugin_github-sdlc-planning_github-sdlc-planning__*, mcp__github-pull-requests__*, mcp__plugin_github-pull-requests_github-pull-requests__*, mcp__github-bug-capture__*, mcp__plugin_github-bug-capture_github-bug-capture__*, mcp__github-repo-config__*, mcp__plugin_github-repo-config_github-repo-config__*, mcp__github-insights__*, mcp__plugin_github-insights_github-insights__*, mcp__github-packages__*, mcp__plugin_github-packages_github-packages__*, mcp__github-org-identity__*, mcp__plugin_github-org-identity_github-org-identity__*, mcp__mif-docs__*, mcp__plugin_mif-docs_mif-mcp__*
---

# Epic pipeline

Turn **$ARGUMENTS** into a tracked, native GitHub work plan and — unless
told to stop at planning — carry it through to a reviewed pull request
ready for the user's merge decision. This skill is the **interactive
trigger**: it resolves scope, gathers every decision, and holds the two
hard gates (confirm-before-execute, confirm-before-merge). The
orchestration itself runs as a background Workflow from the bundled script
at `${CLAUDE_PLUGIN_ROOT}/skills/epic-pipeline/scripts/epic-pipeline.workflow.js`
(plugins cannot ship named workflows, so this skill launches it by path),
launched **twice** — once in `plan` mode, once in `execute` mode — because
a background workflow can ask the user nothing; every question lives here,
between and before the launches. See
`references/gdlc-native-mechanics.md` for the plugin tool inventory and the
native-automation/config/ADR rules the workflow's agents compose.

## Phase 0 — Resolve scope and every decision, interactively

1. Resolve `owner/repo`: an explicit argument, or the current git remote
   (`gh repo view --json nameWithOwner`). `get_session_context` and the
   mutating planning tools default `owner`/`repo` from the layered
   `destination.repo` config when omitted — but the workflow launches need
   a concrete value; if neither an argument nor the git remote gives one,
   ask. Once known, `get_session_context` is worth a call for its
   `openMilestones`/`projectBoard` context and `projectConfigPath`
   diagnostic.
2. Confirm auth up front: call `github-sdlc-planning`'s
   `get_agent_capabilities` (name the plugin — the tool name exists in more
   than one). Board writes need a `project`-scoped classic PAT or an
   App/fine-grained token — don't discover a `missing_scope` failure
   mid-flight after issues already exist.
3. Parse `$ARGUMENTS` four ways: an existing issue (`#123`/URL — read its
   body/labels/type and call `list_sub_issues` for any hierarchy already
   present), a plan/design doc path (read it; pass its substance as the
   seed), or a free-text goal; plus `--plan-only`/`--execute`. If
   `--execute` names a seed that already has a full Epic→Story→Task
   hierarchy via `list_sub_issues`, **skip the plan launch entirely** and
   go straight to the execute launch with that hierarchy — never
   re-decompose or duplicate it. No usable seed at all → ask the user what
   the plan should come from before continuing.
4. Resolve the execute-time decisions now (a background workflow cannot ask
   later): whether to request a Copilot review on the delivered PR
   (`requestCopilot`, default yes), and whether the user wants
   CODEOWNERS-style human reviewer routing — the `pr-review-route` skill
   stays here in the trigger, on confirmation, after the PR exists.

## Launch 1 — plan mode (skipped when a full hierarchy already exists)

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/epic-pipeline/scripts/epic-pipeline.workflow.js",
  args: { mode: "plan", owner, repo, seed }
})
```

The workflow grounds the seed (related code/docs, existing-coverage search,
`get_branch_protection` — required checks surface now, not at PR time) and
decomposes it: the `epic-decomposition` skill for the native hierarchy,
board placement with read-Status-before-write, Kind/Type on every item,
milestone matching, build order in the Epic body.

When it returns:

- Report the hierarchy (Epic URL, every child's number/title/type/Status),
  the milestone outcome (or why none fit), and the branch-protection
  findings.
- Surface every entry in the result's `deferred` list via AskUserQuestion —
  a no-milestone-fits call, a design question worth a `create_discussion`
  (offer it, don't auto-create; a Discussion is for human deliberation the
  pipeline shouldn't pre-empt), a scope ambiguity. Act on the answers.
- **Stop here on `--plan-only` or a declined execute.** Otherwise get
  explicit confirmation before Launch 2 — `--execute` in the original
  arguments counts.

## Launch 2 — execute mode (only after explicit confirmation)

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/epic-pipeline/scripts/epic-pipeline.workflow.js",
  args: { mode: "execute", owner, repo, epicNumber,
          tasks,            // build-order [{number, title}] from the plan result
          requiredChecks,   // from the plan result's branch-protection read
          requestCopilot }
})
```

What it does (encoded in the script — for the record): a prepare agent
creates **one shared feature branch** in an isolated worktree, then Tasks
run **sequentially in build order**, each agent building on its
predecessors' commits — never one branch per Task. Per Task: comment +
Status→In Progress (read first; the `set-in-progress` hook covers hosts
where it's wired), implement with tests, targeted gates, commit; bugs found
go through the `file-bug` skill with `set_lifecycle_state` follow-through,
unplanned work gets its own tracked `create_issue` + board placement +
link-back. A halt on any Task stops the line (later Tasks may depend on
it) and reports the remainder as skipped. Then one deliver agent: full
gates cross-checked against the required-checks list, push, **one** PR via
`create_pull_request` with `Closes #N` for every completed Task,
`classify_pull_request`, `add_pull_request_to_project`, In Review
transitions with comments, `get_linked_issues` to confirm linkage
structurally (`skippedCrossRepo` reported for manual follow-up), and — if
resolved on — a single Copilot request verified via `list_review_requests`.
Finally a settle agent fixes findings, resolves every thread via the
`resolveReviewThread` mutation, and polls `check_pr_readiness` until
`settled: true`. **One Copilot round is the hard cap**, and **the workflow
never merges.**

When it returns, report: the full issue table (number, title, Kind,
Status), completed vs skipped Tasks with reasons, the PR URL and its
labels, the confirmed linkage, every bug/unplanned-work issue filed with
its lifecycle state, and the final readiness verdict. If the user asked for
human reviewer routing in Phase 0, run `pr-review-route` against the PR
now, on confirmation.

## Merge gate and close-out (stays here, never in the workflow)

Do not merge without explicit user approval — a settled readiness verdict
is readiness, not authorization. Once the user approves and the merge is
confirmed (`MERGED` with a real commit SHA, never inferred):

- `sync_linked_issues_project_field` to stamp whatever post-merge board
  field this team tracks across every same-repo linked issue in one call,
  reporting `skippedCrossRepo` entries. Native automation already handles
  the Done *Status* transition on merge where the board has that workflow —
  this fills the fields automation doesn't cover, it is not a duplicate
  Done-setter.
- Roll a Story to Done once all its Tasks are, the Epic once all its
  Stories are — checking current state before writing, same as everywhere
  else.
- Final report.

## Constraints (always)

- Never hand-roll a `gh api graphql` call for anything a plugin tool
  already covers (issue/sub-issue/board/PR/milestone/discussion writes) —
  `resolveReviewThread` is the known exception with no plugin tool.
- PR-to-issue linkage is `github-pull-requests`' owned responsibility
  (ADR-0002) — read it with `get_linked_issues`, never hand-parse
  `Closes #N` text.
- Never write a board Status without confirming it's actually stale first —
  native Projects v2 automations (ADR-0003) may have already set it, and a
  blind overwrite races them.
- Never add an AI-attribution trailer to any commit, PR, issue, or comment.
- Never merge, force-push, delete a branch, or skip hooks/CI without
  explicit per-action user confirmation — and merging never happens inside
  the workflow at all.
- Bug and unplanned-work issues get real lifecycle management
  (`set_lifecycle_state`), not create-and-forget.
- If decomposition or execution scope is genuinely ambiguous, ask — before
  the relevant launch, because a background workflow cannot ask later; and
  don't silently narrow or expand what the seed asked for.

## Additional resources

- `references/gdlc-native-mechanics.md` — the full tool inventory across
  all seven plugins, the native-board-automation and config-layering rules
  the workflow's agents depend on, and the ADRs (0002–0005) that assign
  ownership for each mechanism.
- `scripts/epic-pipeline.workflow.js` — the bundled orchestration script
  both launches run; its stage prompts are the normative encoding of the
  per-Task and delivery behavior described above.
