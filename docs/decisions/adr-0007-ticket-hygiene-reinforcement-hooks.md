---
title: "Non-Blocking Ticket-Hygiene Reinforcement Hooks"
description: "Advisory-only PostToolUse/Stop hooks that nudge Status progression, lifecycle comments, and sub-issue linkage across a plugin's MCP tools, the generic github MCP server, and raw gh CLI calls. Never blocks; complements, not duplicates, ADR-0003."
type: adr
conceptType: semantic
x-ontology:
  id: mif-docs
  version: "1.0.0"
  entity_type: decision-record
category: architecture
tags:
  - adr
  - hooks
  - projects-v2
  - github-sdlc-planning
  - plugin-composition
status: accepted
created: 2026-07-09
updated: 2026-07-09
author: MIF Maintainers
project: gdlc
technologies:
  - claude-code-hooks
  - github-graphql
  - github-projects-v2
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0003-board-status-hygiene.md
  - adr-0004-project-config-surface.md
  - adr-0005-project-config-cwd-resolution.md
  - adr-0006-eliminate-markdown-config-carriers.md
---

# ADR-0007: Non-Blocking Ticket-Hygiene Reinforcement Hooks

## Status

Accepted

## Context

### Background and Problem Statement

This workspace's own global instructions already mandate strict lifecycle
discipline for tracked work: a Projects v2 Status field that progresses
Backlog/Todo through In Progress, In Review, and Done; a comment posted at
every meaningful transition; and native sub-issue linkage for Epic/Story/Task
hierarchies. That policy exists in prose today. Nothing reinforces it at the
point an agent actually performs a touching action, and prose reminders are
known to be forgotten mid-session, exactly the failure mode ADR-0003's own
investigation surfaced for board Status specifically.

The `github-sdlc-plugins` family (`github-sdlc-planning`, `github-pull-requests`,
`github-bug-capture`, and siblings) already exposes MCP tools that create,
update, and transition GitHub issues and pull requests. Those tools, the
generic `github` MCP server, and raw `gh` CLI invocations via `Bash` are three
structurally different surfaces by which an agent can touch the same GitHub
issue or PR, and none of them was watched for hygiene drift after the fact
before this ADR.

### Relationship to ADR-0003 (read this before touching Status logic here)

ADR-0003 already decided, and shipped, the following for board Status
specifically:

- The org project's eleven built-in Projects v2 workflows own Todo-on-add
  and Done-on-close/merge. No tooling in this suite re-implements or races
  those transitions.
- The one gap native automation leaves, In Progress before a PR exists, is
  closed by `github-sdlc-planning`'s `hooks/lib/in-progress.mjs`, a
  `PostToolUse` hook that mutates `set_field_value` via `gh api graphql`.
- ADR-0003 explicitly could not confirm, via the public API, which Status
  value (if any) the built-in `Pull request linked to issue` workflow
  applies (`ProjectV2Workflow` exposes `name`/`enabled` only, not its
  configured target field value).

This ADR's hook is **advisory-only and never mutates Status**, in contrast
to ADR-0003's hook, which does mutate (In Progress). Its status-progression
check exists precisely because ADR-0003 left the `Pull request linked to
issue` mapping unconfirmed: rather than assume it sets In Review, this hook
observes the issue's actual Status after a PR closing it is opened and
surfaces a suggestion, never a mutation, when Status is not already In
Review, Done, or Blocked. It never suggests Todo, In Progress, or Done —
those remain exactly ADR-0003's and native automation's territory. Where
ADR-0003 closed a gap by acting, this ADR closes a different gap (comment
hygiene, sub-issue linkage, and an unconfirmed Status transition) by only
ever suggesting.

### Constraints

- **Non-blocking is a hard constraint, not a preference.** The originating
  goal (`reports/github-ticket-hygiene-hooks/` in the research-harness
  workspace) states it directly: a hook that cannot mechanically verify a
  hygiene rule must stay silent, never guess, and never block the tool call
  it observed.
- A hook process runs outside the MCP JSON-RPC session and cannot call
  `set_field_value`/`list_sub_issues`/other MCP tools directly; every
  read this hook performs goes through `gh api graphql`, the same
  fail-open pattern `in-progress.mjs` already established.
- Hook scripts in this plugin family run dependency-free: no `node_modules`
  at hook-execution time, unlike the MCP servers, which share an npm
  workspace package.
- `PreToolUse`/`PostToolUse` are the only events with access to a specific
  tool call's `tool_name`/`tool_input`; `Stop`/`SubagentStop` carry only the
  common envelope (`session_id`, `transcript_path`, `cwd`).

### Whitespace

A targeted prior-art search found no existing GitHub App, bot, or Claude
Code plugin combining "fires on the agent's own GitHub-touching tool call"
with "nudges Projects v2 Status/sub-issue hygiene specifically." The
closest analogs, `probot/stale` and `zeke/semantic-pull-requests`, are
comment-based and advisory like this design, but react to GitHub-side
webhooks after the fact and so cannot distinguish which client (an MCP tool
call vs. a raw `gh` CLI invocation) performed the touch the way an
agent-side hook can.

## Decision Drivers

### Primary Decision Drivers

1. **Never block.** The originating goal's hard constraint: this capability
   must reinforce discipline through suggestion only, never through a hard
   gate.
2. **Never duplicate ADR-0003.** Whatever this hook checks about Status must
   be additive to, not a re-implementation or a race against, native
   Projects v2 automation and `in-progress.mjs`.
3. **Recognize the touch regardless of surface.** A plugin's own MCP tools,
   the generic `github` MCP server, and raw `gh` CLI calls are three
   observably different tool-call shapes; missing any one of them leaves a
   real gap in coverage 2026 agentic-development practice increasingly
   relies on (an agent freely choosing whichever surface is convenient).

### Secondary Decision Drivers

1. **Fail open, independently, per check.** One unresolvable check (a
   rate-limited GraphQL call) must not suppress a different, resolvable
   finding in the same hook invocation.
2. **Minimize reminder spam.** A single turn touching the same issue five
   times should not produce five identical reminders.
3. **Minimize new dependency surface.** Reuse `in-progress.mjs`'s injected-
   `runGraphQL` testing pattern and dependency-free hook style rather than
   inventing a new one.

## Considered Options

### Option 1: Non-blocking advisory hooks (chosen)

**Description**: A `PostToolUse` hook registered under three matcher groups
(a plugin's own MCP tools, the generic `github` MCP server, raw `gh` CLI via
`Bash`) runs three independent, best-effort checks and surfaces findings via
`hookSpecificOutput.additionalContext` on a plain exit 0. A companion
`Stop`/`SubagentStop` hook consolidates a turn's findings into one reminder.

**Technical Characteristics**: No new blocking levers used (`decision:
"block"`, exit code 2 are both permanently off the table). Every check
degrades to a silent no-op on any ambiguity.

**Advantages**: Satisfies every primary driver directly; matches 2026
AI-code-review practice converging on an "advisory-first, promote-to-
gate-later" rollout norm, since false-positive fatigue erodes trust faster
than a missed issue does (a pattern this session's own research confirmed
against DORA's 2025/2026 State of AI-assisted Software Development data,
which independently finds agentic-AI governance still industry-immature,
making a hard gate the riskier default in this environment specifically).

**Disadvantages**: Cannot be the enforcement mechanism of last resort for a
genuinely non-negotiable rule; a hard requirement still needs a
human-owned or platform-native control (e.g. a required GitHub status
check) layered on top, which this ADR does not attempt to provide.

**Risk Assessment**:

- **Technical Risk**: Low. Reuses `in-progress.mjs`'s proven fail-open
  `gh api graphql` pattern; every check is independently try/caught.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low. Purely additive; a disabled or misbehaving hook
  degrades to silence, never to a broken tool call.

### Option 2: Hard-blocking hook (`decision: "block"` on a detected gap)

**Description**: The same detection logic, but a detected gap blocks the
triggering tool call (`PostToolUse` `decision: "block"`, or a `PreToolUse`
equivalent) until the agent resolves it.

**Technical Characteristics**: Requires the check to be certain, not
best-effort, since a false positive now blocks real work, not just annoys.

**Advantages**: A confirmed gap could never silently go unaddressed, unlike
an advisory reminder an agent is free to ignore.

**Disadvantages**: Directly violates the originating goal's non-negotiable
constraint. Every check here is inherently best-effort (a `gh api graphql`
round trip that can rate-limit, a heuristic transcript scan for a
lifecycle comment): blocking on a heuristic that can be wrong trades a
missed reminder for a broken workflow, the exact false-positive-fatigue
risk the 2026 advisory-first research consensus warns against.

**Disqualifying Factor**: violates the hard non-blocking constraint by
definition; not compatible with this ADR's mandate regardless of technical
merit.

**Risk Assessment**:

- **Technical Risk**: High. A heuristic false positive breaks a real tool
  call, not just an informational message.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: High. Erodes trust in the hook system broadly, the
  documented 2026-practice risk this ADR's research explicitly names.

### Option 3: Do nothing; rely on the existing prose instructions

**Description**: Leave the lifecycle-discipline policy as prose in
CLAUDE.md-equivalent instructions, with no mechanical reinforcement at all.

**Technical Characteristics**: No new code.

**Advantages**: Zero implementation cost.

**Disadvantages**: This is the status quo the originating goal identifies
as insufficient: prose reminders are known to be forgotten mid-session,
the same failure mode ADR-0003's own investigation already documented for
Status specifically (before that ADR's hook existed).

**Disqualifying Factor**: fails the problem statement by definition; has
already been shown insufficient for the narrower Status-only case ADR-0003
addressed.

**Risk Assessment**:

- **Technical Risk**: Low (no new code).
- **Schedule Risk**: Low.
- **Ecosystem Risk**: High. The discipline gap this ADR exists to close
  remains open indefinitely.

## Decision

We adopt **Option 1**. Six constituent design decisions shape the
implementation:

### AD-1: Non-blocking, advisory-only output contract

The hook may only ever speak through `additionalContext`/`systemMessage` on
a plain exit 0; `decision: "block"` and exit code 2 are permanently off the
table for this capability. **Consequence**: a genuinely non-negotiable
hygiene rule still needs a human-owned or platform-native control layered
on top; this hook is never that control.

### AD-2: Tri-matcher registration instead of one broad regex

Three separate matcher groups run the same script: a plugin's own MCP
tools (`mcp__<plugin>__.*`), the generic `github` MCP server
(`mcp__github__.*`), and raw `gh` CLI calls via a `Bash` matcher with
in-script command parsing. **Consequence**: a fourth tool surface in the
future means adding a fourth matcher, not relying on an existing one to
generalize.

### AD-3: Stop/SubagentStop aggregator as a backstop, not the primary detector

Per-touch detection stays on `PostToolUse`, which writes a per-call signal
to a session-scoped scratch file (`hooks/lib/hygiene-scratch.mjs`);
`Stop`/`SubagentStop` only reads that file back and consolidates.
**Consequence**: the two hooks are not redundant; removing either loses a
distinct capability (per-call precision vs. turn-level deduplication).

### AD-4: Copy-and-register distribution across sibling plugins

`github-sdlc-planning` ships the canonical `hooks/lib/hygiene-check.mjs`,
`hooks/lib/hygiene-scratch.mjs`, `hooks/lib/hygiene-aggregate.mjs`,
`hooks/hygiene-check.mjs`, and `hooks/hygiene-aggregate.mjs`.
`github-pull-requests` and `github-bug-capture` each ship a byte-identical
copy under their own `hooks/`, registered in their own `hooks.json` scoped
to their own plugin-tool-name matcher. A CI job
(`.github/workflows/ci.yml`'s `hygiene-hook-drift-check`) diffs every
sibling copy against the canonical version on every PR and fails on any
drift. **This is a deliberate departure from the wider industry norm** of
publish-once/import-by-reference (ESLint shareable configs, Danger.js
plugins, GitHub Actions reusable workflows all converge on that pattern);
it is not available here because hook scripts run with no `node_modules`
at execution time, unlike the MCP servers, which already share an npm
workspace package, and there is no single shared `hooks.json` a "core"
capability automatically propagates from. **Consequence**: the drift-check
CI job is load-bearing, not optional; without it this decision degrades
silently into exactly the drift risk the shared-package pattern exists to
prevent.

### AD-5: Independent, best-effort degradation per check

Status-progression, lifecycle-comment, and sub-issue-linkage each resolve
or skip independently within one hook invocation
(`runHygieneChecks`/`Promise.allSettled` in `hooks/lib/hygiene-check.mjs`).
**Consequence**: the reminder text assembled per call is whichever checks
actually resolved that call; a turn can receive a partial reminder, never
an all-or-nothing one.

### AD-6: Project-level registration as a non-exclusive alternative attachment point

A consuming project's own `.claude/settings.json` can register the
identical matcher set against the identical script without touching any
plugin manifest at all, since hook sources merge additively across policy,
project, user, local, and every enabled plugin's own `hooks/hooks.json`.
Documented as a first-class option, not a fallback, in
`docs/how-to/register-hygiene-hook-at-project-level.md`.
**Consequence**: a consumer's choice between plugin-shipped and
project-registered depends on whether they want the reminder tied to the
plugin's release lifecycle or their own project's; both attachment points
can be active simultaneously without conflict.

## Consequences

### Positive

1. **Closes the discipline gap ADR-0003 left outside its own scope.**
   ADR-0003 only ever addressed board Status; lifecycle comments and
   sub-issue linkage had no mechanical reinforcement at all before this ADR.
2. **Surface-agnostic.** An agent using a plugin's own tools, the generic
   `github` MCP server, or raw `gh` CLI all get the same reminder, closing
   the gap AD-2 identifies in the pre-existing `hooks.json` (which matched
   only `github-sdlc-planning`'s own tool names).
3. **No new blocking failure mode.** Every check fails open; a hook bug, a
   `gh` auth failure, or a rate limit degrades to silence, never to a
   broken tool call, by construction (`Promise.allSettled` inside
   `runHygieneChecks`, plus a top-level error handler in each entrypoint --
   `hygiene-check.mjs`'s `main().catch(() => emitEmpty())` and
   `hygiene-aggregate.mjs`'s `try { main(); } catch { emitEmpty(); }`,
   the latter wrapping a plain synchronous `main` rather than an async one).

### Negative

1. **Best-effort, not exhaustive.** The lifecycle-comment check is
   deliberately over-inclusive about which actions count as "a transition"
   (any `set_field_value`/`update_issue`/`create_issue` call, since a bare
   `fieldId` does not identify which field changed without a second round
   trip this hook does not make). This is an accepted heuristic
   imprecision, not a violation of the "never guess" constraint, which
   governs the resolved/unresolved distinction between checks, not this
   heuristic's own recall/precision trade-off.
2. **Copy-and-register duplication (AD-4) is a real maintenance cost**,
   mitigated but not eliminated by the drift-check CI job: three copies of
   the same logic exist in the repository, and the drift check only fires
   on a PR, not continuously.

### Neutral

1. **This ADR does not change ADR-0003's decision in any way.** Native
   Projects v2 automation still owns Todo-on-add and Done-on-close/merge;
   `in-progress.mjs` still owns the In Progress mutation. This ADR adds a
   read-only, advisory layer alongside those, never a replacement.

## Decision Outcome

The decision achieves its objective, non-blocking reinforcement across all
three tool-agnostic surfaces, measured by: `hooks/hygiene-check.mjs` and
`hooks/hygiene-aggregate.mjs` (and their `lib/` modules) contain no
`process.exit` call and no `decision: "block"` output anywhere; the
`hygiene-hook-drift-check` CI job fails a PR that lets a sibling copy
diverge from the canonical version; and `mcp-server/test/unit/hygiene-check-hook.test.ts`,
`hygiene-scratch-aggregate.test.ts`, and `hygiene-entrypoints.test.ts`
(the last spawning the entrypoint scripts directly, the same contract
Claude Code itself uses) cover every check's resolved, no-gap, and
fail-open paths, including the entrypoints' own crash-safety on malformed
stdin -- see the 2026-07-09 Audit entries below for the two local-review
rounds that found and closed the gaps this coverage now guards.

## Related Decisions

- [ADR-0003: Rely on Native Projects v2 Workflows for Status Hygiene][adr-0003] —
  this ADR's Status-progression check is scoped to the gap ADR-0003's
  decision left unconfirmed (the `Pull request linked to issue` workflow's
  target value), and never touches Todo/In Progress/Done, which remain
  entirely ADR-0003's and native automation's territory.
- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004],
  [ADR-0005: Upward Directory Search for Project Config][adr-0005],
  [ADR-0006: Eliminate the Remaining Markdown Config Carriers][adr-0006] —
  this ADR introduces no new config carrier or resolution mechanism; the
  hygiene hook reads no `.config/gdlc/config.yml` section of its own.

## Links

- Epic [#156](https://github.com/modeled-information-format/gdlc/issues/156) —
  this ADR's tracking epic.
- `reports/github-ticket-hygiene-hooks/github-ticket-hygiene-hooks.ai-architecture-doc.md`
  (zircote/research-harness) — the originating architecture document this
  ADR's AD-1 through AD-6 are drawn from.
- [Claude Code Docs: Hooks reference][cc-hooks] — event catalog, input
  schema, matcher syntax this hook's registration relies on.
- [probot/stale][probot-stale], [zeke/semantic-pull-requests][semantic-prs] —
  the closest prior-art analogs; both comment-based and advisory, neither
  agent-side.

## More Information

- **Date:** 2026-07-09
- **Source:** Epic #156; the originating architecture document in
  zircote/research-harness.
- **Related ADRs:** ADR-0003, ADR-0004, ADR-0005, ADR-0006.

## Audit

### 2026-07-09

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Status-progression check never targets Todo/In Progress/Done, only In Review, reconciled explicitly against ADR-0003 | plugins/github-sdlc-planning/hooks/lib/hygiene-check.mjs | - | compliant |
| Neither entrypoint calls process.exit or emits decision: "block" | plugins/github-sdlc-planning/hooks/hygiene-check.mjs, hygiene-aggregate.mjs | - | compliant |
| Sibling copies verified byte-identical to canonical at authoring time; drift-check CI job added | plugins/github-pull-requests/hooks/, plugins/github-bug-capture/hooks/, .github/workflows/ci.yml | - | compliant |

**Summary:** Drafted and accepted in the same session the implementing
Epic (#156) and its Stories/Tasks (#157-171) were filed and executed; no
open objections to the advisory-only contract, the tri-matcher design, or
the copy-and-register distribution model.

**Action Required:** None for this ADR.

### 2026-07-09

**Status:** Compliant (with one filed follow-up)

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Round 1: `hygiene-aggregate.mjs`'s bare `main()` call could crash with a non-zero exit on a null-shaped stdin payload or a malformed scratch entry, contradicting this ADR's own AD-1 claim; the `gh` CLI surface only recognized `gh pr create`, leaving `checkLifecycleComment`/`checkSubIssueLinkage` unreachable from `gh issue create`/`edit`/`close`, contradicting the surface-agnostic decision driver; a digit in a title/body could be mis-captured as the target issue number; `checkLifecycleComment` was called eagerly rather than deferred, risking silently discarding the other two checks' findings on a synchronous throw | plugins/*/hooks/hygiene-aggregate.mjs, plugins/*/hooks/lib/hygiene-check.mjs | - | fixed |
| Round 2: `checkSubIssueLinkage` fired on a close, contradicting its own documented "skips a close" behavior; the MCP branch only handled a flat-object `tool_output`, missing the MCP content-array wrapper shape a sibling hook (`validate-mif.mjs`) already handles for the same tool family; `mcp__github__issue_write` was miscategorized as a comment action, which is not this tool's actual semantics (`method: 'create'\|'update'`) | plugins/*/hooks/lib/hygiene-check.mjs | - | fixed |
| Round 3: `scanTranscriptForComment` read the entire session transcript unbounded on every qualifying touch, rather than a bounded tail window the way `diagnostic-capture.mjs` already does for the same class of file; this ADR's own Audit/Decision-Outcome text had not been updated after rounds 1-2 landed | plugins/*/hooks/lib/hygiene-check.mjs, this file | - | fixed |
| Round 3: `checkLifecycleComment` cannot resolve an issue/PR's identity for a `set_field_value` touch, since that tool's own input/output only ever carries `itemId`/`fieldId`, never `owner`/`repo`/`number` -- the check is structurally unreachable for the single most direct way an agent changes a board Status field | plugins/github-sdlc-planning/hooks/lib/hygiene-check.mjs | - | filed as a follow-up issue (requires a design decision -- resolving `itemId` to issue coordinates needs an async GraphQL round trip inside what is currently a synchronous, dependency-free `extractTouch`), not fixed in this PR |

**Summary:** Three independent local-review rounds ran against the
implementing branch before the PR opened, per this workspace's mandatory
pre-PR review convention. Every finding that was a mechanical, in-scope
fix landed in the same branch (regression-tested, including one test
verified to fail against the pre-fix code and pass against the fix). The
one finding requiring a real architecture decision (`set_field_value`
touches carrying no issue identity) is filed as a tracked follow-up issue
rather than decided unilaterally.

**Action Required:** Track and resolve the filed follow-up issue for the
`set_field_value` identity gap.

### 2026-07-10

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Issue #172 (the `set_field_value` identity gap from the 2026-07-09 audit) resolved: `checkLifecycleComment` is now `async` and resolves a `set_field_value` touch's `itemId` to `owner`/`repo`/`number` via a new `resolveItemIdentity` GraphQL round trip (`node(id: itemId) { ... on ProjectV2Item { content { ... on Issue/PullRequest { number repository { owner { login } name } } } } }`) before scanning for a lifecycle comment, failing open (no finding) on any ambiguity -- a Draft Issue item with no linked content, a malformed response, or a GraphQL error -- the same as every other unresolvable case in this file. `extractTouch` carries the bare `itemId` through as a passthrough field for `set_field_value` touches (still synchronous and dependency-free itself); only `checkLifecycleComment` performs the resolution, and only when it actually needs to. | plugins/*/hooks/lib/hygiene-check.mjs | - | compliant |

**Summary:** Of the three design options issue #172 weighed (an async
GraphQL resolution inside `checkLifecycleComment`; a fragile scratch-file
`itemId` lookup; permanently documenting the gap as out of scope), the
GraphQL resolution was chosen and implemented, closing #172. Verified
end-to-end (extraction through resolution through finding) and covered by
new unit tests for `resolveItemIdentity` and for `checkLifecycleComment`'s
`set_field_value` path (resolved-with-finding, resolved-no-finding,
ambiguous-response fail-open, GraphQL-error fail-open, and no-itemId
short-circuit).

**Action Required:** None; issue #172 is resolved.

[adr-0003]: adr-0003-board-status-hygiene.md
[adr-0004]: adr-0004-project-config-surface.md
[adr-0005]: adr-0005-project-config-cwd-resolution.md
[adr-0006]: adr-0006-eliminate-markdown-config-carriers.md
[cc-hooks]: https://code.claude.com/docs/en/hooks
[probot-stale]: https://github.com/probot/stale
[semantic-prs]: https://github.com/zeke/semantic-pull-requests
