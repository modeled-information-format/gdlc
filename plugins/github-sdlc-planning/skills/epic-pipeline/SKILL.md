---
description: Decompose a GitHub issue, plan/design doc, or free-text goal into a native Epic/Story/Task hierarchy and carry it through to a reviewed, merged pull request — composing every github-sdlc-plugins tool (planning, PR lifecycle, bug capture, repo governance, insights, packages, org identity) instead of hand-rolled gh/GraphQL calls. Use when the user asks to "run the epic pipeline", "plan and build this epic", "turn this into a work plan and implement it", or "decompose and ship this".
when_to_use: Trigger on "run the epic pipeline", "plan and execute this epic end to end", "decompose this and build it", "turn this goal into issues and ship a PR", or when a seed issue/plan/goal needs full Epic-to-merged-PR delivery in a repo where the github-sdlc-plugins are installed.
argument-hint: "[owner/repo] [#issue | path/to/plan.md | free-text goal] [--plan-only | --execute]"
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, mcp__github-sdlc-planning__*, mcp__github-pull-requests__*, mcp__github-bug-capture__*, mcp__github-repo-config__*, mcp__github-insights__*, mcp__github-packages__*, mcp__github-org-identity__*, mcp__mif-docs__*
---

# Epic pipeline

Turn **$ARGUMENTS** into a tracked, native GitHub work plan and — unless told
to stop at planning — carry it through to a reviewed, merged pull request.
This is the `github-sdlc-plugins`-native counterpart to the general-purpose
`/epic-pipeline` command: the same two-phase shape, but every step composes a
plugin's own MCP tool or sibling skill instead of a hand-rolled `gh api
graphql` call. See `references/gdlc-native-mechanics.md` for the full
seven-plugin tool inventory and the native-automation/config/ADR rules that
make this composition safe.

## Phase 0 — Resolve scope and ground the plan

1. Resolve `owner/repo`: an explicit argument, or the current git remote
   (`gh repo view --json nameWithOwner`). `get_session_context` and the
   mutating planning tools (`create_issue`, `add_item_to_project`, ...) take
   `owner`/`repo` as *optional* args that default from the layered
   `destination.repo` config when omitted — but they need a concrete value
   supplied or resolved before this step, they don't discover one. If
   neither an argument nor the git remote gives a repo, ask; don't rely on a
   config default to fill a value this step itself needs to search issues,
   read branch protection, etc. Once a repo is known, `get_session_context`
   is worth a call for its `openMilestones`/`projectBoard` context and its
   `projectConfigPath` field — a debugging aid naming which config file (if
   any) resolved, useful if a later default looks wrong.
2. Confirm auth up front, the same way the `project-setup` agent does: call
   `github-sdlc-planning`'s `get_agent_capabilities` (the tool name exists in
   more than one plugin — name the plugin so the wrong capability checker
   isn't picked). Board writes need a `project`-scoped classic PAT or an
   App/fine-grained token — don't discover a `missing_scope` failure
   mid-pipeline after issues already exist.
3. Parse `$ARGUMENTS` the same four ways the general-purpose command does: an
   existing issue (`#123`/URL — read its body/labels/type and call
   `list_sub_issues` for any hierarchy already present), a plan/design doc
   path, or a free-text goal; plus `--plan-only`/`--execute`. If `--execute`
   names a seed issue that already has a full Epic→Story→Task hierarchy via
   `list_sub_issues`, skip Phase 1 entirely and go straight to Phase 2 rather
   than re-decomposing or duplicating it. No usable seed at all → ask the
   user what the plan should come from before continuing.
4. Ground the plan: read related code/docs, search for existing coverage
   (`gh issue list --search`; `search_similar_issues` if the goal reads like
   a defect rather than new work), and note what's already true vs.
   genuinely missing — don't invent scope the seed doesn't support.
5. Call `get_branch_protection` on the repo's default branch. Surface its
   required status checks now — Phase 2 needs to know what "green" means
   before opening a PR, not discover a missing check at PR time. Note
   `enforceAdmins`/review-count too; flag anything unusually permissive for
   the user to judge.

## Phase 1 — Decompose into Epic → Story → Task

1. Use the `epic-decomposition` skill for the actual issue tree: one Epic,
   Stories under it, Tasks under each Story, all via native `add_sub_issue` —
   never a hand-written checklist. If the seed was already an Epic, extend
   it rather than creating a duplicate parent.
2. For every issue created, call `add_item_to_project` regardless of whether
   the target board auto-adds — the tool is idempotent (returns `existed:
   true` on a duplicate instead of creating one), so a separate existence
   check first would just re-read the same fact. Then read the returned
   item's current `Status`: set it to the board's backlog-equivalent **only
   if it's unset** — where the board has a native auto-add workflow, that
   workflow already set it, and overwriting it races that automation. Always
   set the Kind/Type field to Epic/Story/Task; no native automation sets
   that one.
3. Assign a milestone (`list_milestones` → `assign_milestone`) if the goal
   maps to one already open; if none fits, say so explicitly rather than
   guessing or leaving it silently blank.
4. If the seed carries a genuine open design question (not just an
   implementation detail), offer — don't auto-create — a `create_discussion`
   linked back to the Epic, since a Discussion is for human deliberation the
   pipeline shouldn't pre-empt.
5. Note build order in the Epic's body as an ordered list — sub-issues carry
   no ordering field of their own.
6. Report the hierarchy: Epic URL, every child's number/title/type/Status,
   the milestone (or why none fit), and the branch-protection findings from
   Phase 0. Stop here on `--plan-only` or a declined execute.

## Phase 2 — Execute

Only after explicit confirmation (or `--execute`).

1. For each Task, in build order:
   - Start work by calling `update_issue` (or `add_sub_issue` if it's new) —
     the plugin's own `set-in-progress` hook flips a Todo/unset board item
     to In Progress on exactly this call, where a board mapping is
     configured. Don't also hand-call `set_field_value` for the same
     transition unless a follow-up `get_project_items` read shows it didn't
     take (hook disabled or unconfigured). Comment on the issue at the
     transition either way — never a silent flip.
   - Implement the change on **one shared feature branch**, never one branch
     per Task: a stacked base only re-targets when its parent merges, and
     merging a non-default base doesn't close anything.
   - Bug found mid-implementation → the `file-bug` skill, never a hand-rolled
     `create_issue`. If it gets resolved before the PR goes up, move it
     forward with `set_lifecycle_state` (`closeIfDone` if actually done)
     instead of leaving it at its filed state forever.
   - Necessary work the plan didn't cover → its own `create_issue`
     (`mif.type` set appropriately), sub-issue- or relates-to-linked back to
     the Task/Story/Epic. `create_issue` cannot set Projects v2 board fields
     itself — follow it with `add_item_to_project` and the same
     read-Status-before-writing `set_field_value` step Phase 1 uses for
     Kind/Status, never only a PR/commit comment. Track it for the final
     report.
2. Run the repo's real gates and fix failures before opening a PR;
   cross-check failures against Phase 0's required-checks list so nothing
   here is a surprise.
3. Open **one** PR via `create_pull_request` (not `gh pr create`), with
   `Closes #N` for every Task. Then:
   - `classify_pull_request` for `type:`/`size:`/`risk:` labels.
   - `add_pull_request_to_project` to put the PR itself on the board.
   - The `pr-review-route` skill for CODEOWNERS-driven reviewer routing, on
     confirmation; separately request Copilot review via the same
     `request_review` tool (`reviewers: ["Copilot"]`) — it calls the
     identical `requested_reviewers` REST endpoint a hand-rolled `gh api`
     call would, so there is no reason to bypass the plugin tool here.
     Copilot only fires on a non-draft PR, so don't open as draft if a
     Copilot pass is wanted.
   - `get_linked_issues` to confirm — not assume — which Tasks the PR's
     `closingIssuesReferences` actually resolved (it retries; linkage
     populates asynchronously). Anything reported in `skippedCrossRepo`
     needs an explicit manual link and a note to the user, since `Closes #N`
     only closes same-repo issues.
   - Set every linked Task's/Story's Status → In Review with a comment,
     again only if it isn't already there.
   - Once Copilot review is requested, do not report the PR "ready" or watch
     it with a hand-written Monitor bash loop (`gh pr checks` + ad hoc `jq`)
     — issue #185/#188 exists precisely because those improvised checks
     either watched only one signal (CI status, missing unresolved review
     threads) or never reliably triggered at all. If `github-pull-requests`
     is available, call its `check_pr_readiness` MCP tool (or run its
     `scripts/pr-readiness.ts` CLI script — `npm run pr-readiness -- <owner>
     <repo> <pullNumber>` from that plugin's `mcp-server/` — in a Monitor
     poll loop) instead: it returns one settled/not-settled verdict already
     combining checks, review state, review-thread resolution, and
     code-scanning alerts, and is unit-tested against exactly the three
     scenarios a hand-rolled check tends to get wrong (pending, green-but-
     unresolved-threads, and actually settled). Only report a PR ready once
     that tool reports `settled: true`.
4. Do not merge without explicit user approval. Once merged:
   - Call `sync_linked_issues_project_field` to stamp whatever board field
     this team tracks post-merge (a "Shipped in" iteration, a release
     column) across every same-repo linked issue in one call, reporting
     `skippedCrossRepo` entries for manual follow-up. Native automation
     already handles the Done *Status* transition on merge where the board
     has that workflow — this call fills the fields native automation
     doesn't cover, it is not a duplicate Done-setter.
   - Roll a Story to Done once all its Tasks are, the Epic once all its
     Stories are, checking current state before writing, same as step 1.
5. Final report: the full issue table (number, title, Kind, Status), the PR
   URL and CI state, `classify_pull_request`'s applied labels, the confirmed
   linkage from `get_linked_issues`, and every bug/unplanned-work issue filed
   with its current lifecycle state.

## Constraints (always)

- Never hand-roll a `gh api graphql` call for anything a plugin tool already
  covers (issue/sub-issue/board/PR/milestone/discussion writes) — that
  duplication is exactly the shallow scope this skill replaces.
- PR-to-issue linkage is `github-pull-requests`' owned responsibility
  (ADR-0002) — read it with `get_linked_issues`, never hand-parse `Closes #N`
  text.
- Never write a board Status this pipeline hasn't confirmed is actually
  stale first — native Projects v2 automations (ADR-0003) may have already
  set it, and a blind overwrite races them.
- Never add an AI-attribution trailer to any commit, PR, issue, or comment.
- Never merge, force-push, delete a branch, or skip hooks/CI without
  explicit per-action user confirmation.
- Bug and unplanned-work issues get real lifecycle management
  (`set_lifecycle_state`), not create-and-forget.
- If decomposition or execution scope is genuinely ambiguous, ask — don't
  guess, and don't silently narrow or expand what the seed asked for.

## Additional resources

- `references/gdlc-native-mechanics.md` — the full tool inventory across all
  seven plugins, the native-board-automation and config-layering rules this
  pipeline depends on, and the ADRs (0002–0005) that assign ownership for
  each mechanism.
