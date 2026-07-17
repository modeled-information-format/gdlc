---
title: "Session Monitors: Time-Driven Ticket-Hygiene Shepherding"
description: "Opt-in background plugin monitors (board-hygiene, pr-settlement, bug-triage) that watch for lifecycle drift between events and nudge the acting model to the next step. Advisory-only, session-scoped via a hook-written cwd pointer; complements, never replaces, the ADR-0007 hooks."
type: adr
conceptType: semantic
x-ontology:
  id: mif-docs
  version: "1.0.0"
  entity_type: decision-record
category: architecture
tags:
  - adr
  - monitors
  - hooks
  - projects-v2
  - plugin-composition
status: accepted
created: 2026-07-17
updated: 2026-07-17
author: MIF Maintainers
project: gdlc
technologies:
  - claude-code-monitors
  - claude-code-hooks
  - github-graphql
  - github-projects-v2
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0002-pr-issue-linkage-ownership.md
  - adr-0003-board-status-hygiene.md
  - adr-0004-project-config-surface.md
  - adr-0007-ticket-hygiene-reinforcement-hooks.md
---

# ADR-0010: Session Monitors: Time-Driven Ticket-Hygiene Shepherding

## Status

Accepted

## Context

### Background and Problem Statement

ADR-0007's hygiene hooks and ADR-0003's board-status hook are event-driven:
they observe a tool call the moment it happens and react to that call. An
entire class of hygiene drift is invisible to them by construction, because
it consists of things NOT happening:

- an issue sits In Progress while uncommitted work goes stale in the
  session's working tree ("code is committed" has no event);
- a Copilot or human review lands on a session-opened PR while the acting
  model has already moved on to other work (review-thread-gate.mjs only
  fires when NEW branch work starts, not when the review arrives);
- an issue is closed but its board Status never reaches Done (the native
  Item-closed workflow failed or raced), and no further tool call ever
  touches that issue again this session;
- a bug gets filed by the diagnostic-capture flow and never triaged.

Claude Code's plugin system now ships an experimental **monitors**
component (`monitors/monitors.json`): a plugin can declare persistent
background processes the host starts at session start, whose every stdout
line is delivered to the acting model as a notification. That is exactly
the missing half: a time-driven, session-scoped watcher that can shepherd
the model to the next lifecycle step when drift accumulates between
events.

### Relationship to ADR-0003 and ADR-0007 (division of labor)

- **Hooks act or suggest at event time; monitors observe on a clock.**
  Nothing a monitor does duplicates a hook check that already fires at the
  moment of the touch (e.g. ADR-0007's In-Review suggestion when a PR
  opens); monitors report only drift that persists or arrives between
  events.
- **Monitors never mutate.** ADR-0003's set-in-progress hook remains the
  single Status writer in this suite; native Projects v2 workflows retain
  Todo-on-add and Done-on-close/merge. A monitor reports that native
  automation apparently failed (closed-but-not-Done); it never repairs it.
- **Ownership follows ADR-0002:** the PR-settlement monitor lives in
  `github-pull-requests`, board hygiene in `github-sdlc-planning`, bug
  triage in `github-bug-capture`.

### Constraints

- Monitors run unsandboxed at hook trust level, only in interactive CLI
  sessions, and are skipped where the host's Monitor mechanism is
  unavailable. A monitor process that exits is NOT restarted until the
  session restarts.
- A monitor `command` cannot reference `${user_config.*}` and receives no
  `CLAUDE_PLUGIN_OPTION_*` environment; configuration must come from files
  — which is already this suite's convention (`.config/gdlc/config.yml`).
- A monitor starts with no `session_id` and no tool-call context; it knows
  only its own cwd (the session working directory). Every other scratch
  file in this suite is keyed by session_id.
- Monitor processes run dependency-free (bare `node`, no `node_modules`),
  the same constraint hooks already live under.
- The component is experimental: its manifest schema may change between
  Claude Code releases.

## Decision Drivers

### Primary Decision Drivers

1. **Close the between-events gap.** The drift classes above have no
   event-driven detection point even in principle; a clock is the only
   trigger that exists.
2. **Shepherd, never block, never spam.** One terse, actionable line per
   NEW condition ("next step: ..."), silence otherwise. A monitor that
   repeats itself every 90 seconds would be disabled by every user within
   a day, the same false-positive-fatigue failure ADR-0007's research
   documented for hooks.
3. **Stay inside the suite's proven conventions.** Fail-closed opt-in
   config, dependency-free scripts, DI'd pure-function cores tested from
   the mcp-server vitest suites, byte-copy sharing with a CI drift check.

### Secondary Decision Drivers

1. **Rate-limit frugality.** One batched GraphQL call per monitor per
   cycle, with jitter and failure backoff.
2. **Mid-session config changes must work.** A monitor that exits when it
   finds the pack disabled can never be enabled mid-session (no restart).
3. **Session binding must be read-only from the monitor side** so monitors
   remain pure consumers of hook-written state, never a second writer.

## Considered Options

### Option 1: Plugin monitors component (chosen)

**Description**: Three monitors — `board-hygiene` (github-sdlc-planning),
`pr-settlement` (github-pull-requests), `bug-triage` (github-bug-capture)
— each a dependency-free `node` process declared in the plugin's
`monitors/monitors.json`, sharing one poll→assess→emit-once harness
(`monitors/lib/monitor-core.mjs`) and resolving their session via a
hook-written cwd→session_id pointer file.

**Advantages**: Native host integration (task-panel visibility, stdout
lines delivered as notifications to the acting model — the only channel
that actually *shepherds*); session-scoped by construction; inherits the
session's `gh` auth.

**Disadvantages**: Experimental component (schema may move); interactive
CLI sessions only; a crashed monitor stays dead until session restart,
which forces the never-exit design below.

**Risk Assessment**: Technical risk low-medium (experimental surface, but
the fallback is graceful: a host without monitor support simply never
starts the process). Ecosystem risk low (opt-in, advisory-only).

### Option 2: Abuse hooks for time-based checks

**Description**: Run the same drift checks inside existing hook events —
e.g. a Stop-hook that re-examines everything at every turn boundary, or
PostToolUse hooks that poll opportunistically.

**Disadvantages**: Hooks run under a 15-second timeout on someone else's
critical path — polling GraphQL there taxes every tool call; a turn
boundary is still an event, so a session that goes quiet (the model busy
on a long task, or idle) gets no detection at all, which is precisely the
gap to close; and "the review landed while you worked" cannot be surfaced
mid-turn by a Stop hook.

**Disqualifying Factor**: does not actually close the between-events gap —
detection still requires an event to fire.

**Risk Assessment**: Technical risk medium (hook-path latency), ecosystem
risk high (every tool call pays for polling).

### Option 3: External watcher (scheduled GitHub Actions / gh-aw workflow)

**Description**: A repo- or org-side scheduled workflow that scans boards
and PRs for the same drift and comments/labels accordingly.

**Advantages**: Not tied to an interactive session; covers drift nobody's
session is watching.

**Disadvantages**: Has no session context (cannot know which issue THIS
session is working, which PRs THIS session opened, or whether the working
tree is dirty); cannot deliver a nudge into the acting model's
conversation, so it shepherds nobody; minimum practical cadence (5+
minutes, often throttled) is worse than a local 90-second poll.

**Disqualifying Factor**: cannot reach the acting model, which is the
entire point of shepherding; complements rather than substitutes (a future
org-side sweep remains open as future work).

**Risk Assessment**: Technical risk low, but it solves a different
problem.

## Decision

We adopt **Option 1**. Eight constituent design decisions shape the
implementation:

### AD-1: Advisory-only, never-mutate contract

Monitors only ever emit stdout notification lines; no monitor performs any
GraphQL mutation, ever. **Consequence**: the ADR-0003 single-writer
invariant survives intact; a monitor finding that native automation failed
is a nudge to the model, not a repair.

### AD-2: Opt-in `packs.monitors`, checked every cycle, never-exit idle

A new `monitors` pack name in the open `packs:` boolean map (no schema
change; fail-closed like every toggle in this suite). Because a dead
monitor is unrecoverable until session restart, a disabled monitor idles
at a slow 5-minute re-check (zero GitHub calls, zero output) instead of
exiting — so enabling the pack mid-session takes effect within minutes.
V1 ships tuning values (90s ± 20s poll, 120s initial delay, 30-minute
re-emit cooldown, 30-minute commit-staleness, 15-minute triage grace) as
constants; a `monitors:` config section is deliberately deferred until
real tuning demand exists (ADR-0004's minimal-surface principle).

### AD-3: Hook-written cwd→session_id pointer as the session bridge

A new `hooks/lib/session-pointer.mjs` writes
`tmpdir()/gdlc-session-pointer/<sha256(cwd)[0:12]>.json` =
`{sessionId, cwd, updatedAt}` from a SessionStart entrypoint (matcher
`startup|resume|clear|compact`) in all three plugins, refreshed
mid-session by already-firing non-family PostToolUse hooks
(`set-in-progress.mjs`, `track-opened-prs.mjs`, `track-created-issues.mjs`).
Monitors re-resolve the pointer every cycle (exact cwd match first, then
freshest prefix-related entry, 24-hour staleness cap) and remain pure
readers. **Accepted residual**: concurrent sessions in one cwd are
last-writer-wins; the worst case is an advisory nudge about a sibling
session's item — same accepted-residual class as first-edit-scratch.mjs's
own documented limitation.

### AD-4: Emit-once via state-qualified dedup keys plus cooldown

Every finding carries a dedup key that encodes the OBSERVED STATE (head
sha, thread count, status-changed-at, dirty-since), persisted per
session+monitor in `tmpdir()/gdlc-monitor-scratch/`. A changed condition
produces a new key and re-arms immediately; a persisting one re-emits only
past a 30-minute cooldown. All fresh findings in a cycle collapse into ONE
stdout line (`gdlc <monitor>: ...`), the hygiene-aggregate consolidation
precedent. The store is age-pruned and hard-capped.

### AD-5: Byte-copy family #2 with its own CI drift-check loop

`monitors/lib/monitor-core.mjs`, `hooks/lib/session-pointer.mjs`, and
`hooks/session-pointer.mjs` are canonical in `github-sdlc-planning` and
byte-copied to `github-pull-requests` and `github-bug-capture`, guarded by
a second loop in the `hygiene-hook-drift-check` CI job — deliberately
separate from the ADR-0007 loop so the two families' membership can
diverge. monitor-core re-implements the `packs:` slice reader rather than
importing `settings.mjs`/`in-progress.mjs` (which only the planning plugin
ships) — the same per-plugin-boundary duplication AD-4 of ADR-0007 already
justified. Each monitor's checks (`board-hygiene.mjs`,
`pr-settlement.mjs`, `bug-triage.mjs`) and its `monitors.json` are
plugin-specific and NOT copied.

### AD-6: Default-directory declaration, not a manifest key

Monitors are declared via the auto-discovered `monitors/monitors.json`
default location. A top-level `monitors` plugin.json key draws a validator
warning today, and `experimental.monitors` risks older validators
rejecting an unknown key; the default directory is invisible to manifest
validation and IS the documented stable location across the announced
migration. Verified against both the CI-pinned CLI (2.1.199) and current
(2.1.212) validators.

### AD-7: Data-source hooks are widened/added where the monitor needs them

`track-opened-prs.mjs`'s gating widens from "prLifecycle gate enabled" to
"prLifecycle gate enabled OR monitors pack enabled" — pr-settlement's data
source must populate for monitors-only users; this deliberately couples
one prLifecycle-family hook to the monitors pack. `github-bug-capture`
gains `hooks/track-created-issues.mjs` + `hooks/lib/session-issues.mjs`
(monitors-pack-gated), because the hygiene family's scratch is
intentionally cleared at every turn boundary (ADR-0007 AD-3) and so cannot
serve as session-long memory; its matchers deliberately include
`github-sdlc-planning__create_issue`, the normal issue-creation surface
where these plugins are installed together.

### AD-8: Session-scoped, not board-wide

bug-triage watches only bugs created THIS session; board-wide staleness
remains the territory of the `triage`/`milestone-triage` skills (and a
possible future org-side scheduled sweep, Option 3's complement).
**Consequence**: a bug filed outside any monitored session is never
nudged by a monitor — accepted, since without session context a monitor
is just a worse cron job.

## Consequences

### Positive

1. **The between-events gap has a watcher.** Stale In Progress work,
   unsettled PRs, untriaged bugs, and failed native transitions now get
   surfaced to the acting model while it can still act, not discovered by
   a human at review time.
2. **Zero cost until opted in.** No pack, no board config, no session
   pointer — each independently degrades the monitors to silent idling.
3. **The hooks got a reusable session bridge.** The cwd→session_id pointer
   is generic infrastructure any future session-scoped consumer can read.

### Negative

1. **An experimental host surface is now load-bearing for an opt-in
   feature.** A future manifest-schema change may require a coordinated
   release; mitigated by AD-6's most-conservative declaration choice.
2. **Byte-copy family #2 doubles the drift-check maintenance surface**
   (same accepted cost as ADR-0007 AD-4, same mitigation).
3. **Advisory nudges can be wrong** (issue-side `projectItems` omissions
   for cross-owner boards, the last-writer-wins pointer residual, the
   Blocked-comment proxy using item `updatedAt`) — each costs one wrong
   line, never a wrong mutation; each is documented at its code site.

### Neutral

1. **Nothing about ADR-0003/0007 changes.** Hooks keep every event-time
   responsibility they had; monitors are additive.
2. **Disabling the plugin mid-session does not stop running monitors**
   (host behavior); they idle out at session end.

## Decision Outcome

The decision achieves its objective — time-driven, advisory, session-scoped
shepherding — measured by: no monitor file contains a GraphQL mutation;
`monitor-core.mjs` contains no unconditional `process.exit` on the cycle
path (the loop survives every injected failure in its tests); the
drift-check CI job fails a PR that lets a family-#2 copy diverge; and the
three plugins' vitest suites cover every check's nudge, silent, and
fail-open paths plus the tracker hooks' pack gating (spawn-style, the same
contract the host uses).

## Related Decisions

- [ADR-0002: PR/Issue Linkage Ownership][adr-0002] — monitor-to-plugin
  assignment follows its ownership boundaries.
- [ADR-0003: Rely on Native Projects v2 Workflows for Status Hygiene][adr-0003]
  — the single-writer invariant AD-1 preserves; board-hygiene reports
  drift FROM native automation, never repairs it.
- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004]
  — the `packs.monitors` toggle rides the existing config surface; AD-2
  defers any new section.
- [ADR-0007: Non-Blocking Ticket-Hygiene Reinforcement Hooks][adr-0007] —
  the event-driven half of this capability; AD-4/AD-5 reuse its
  consolidation and byte-copy disciplines.

## Links

- Issue [#297](https://github.com/modeled-information-format/gdlc/issues/297)
  — this ADR's tracking issue.
- [Claude Code Docs: Plugins reference — Monitors][cc-monitors] — the
  component contract (declaration, lifecycle, notification delivery) this
  design targets.

## More Information

- **Date:** 2026-07-17
- **Source:** Issue #297.
- **Related ADRs:** ADR-0002, ADR-0003, ADR-0004, ADR-0007.

## Audit

### 2026-07-17

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| No monitor performs a GraphQL mutation; every emitted line is advisory | plugins/*/monitors/ | - | compliant |
| Disabled-pack path makes zero GitHub calls and zero output, verified by injected-clock loop tests | plugins/github-sdlc-planning/mcp-server/test/unit/monitor-core.test.ts | - | compliant |
| Family-#2 copies byte-identical at authoring time; second drift-check loop added | .github/workflows/ci.yml | - | compliant |
| Both the CI-pinned (2.1.199) and current (2.1.212) validators pass a plugin carrying monitors/monitors.json | - | - | compliant |

**Summary:** Drafted and accepted in the same session the implementing
issue (#297) was filed and executed.

**Action Required:** None for this ADR.

[adr-0002]: adr-0002-pr-issue-linkage-ownership.md
[adr-0003]: adr-0003-board-status-hygiene.md
[adr-0004]: adr-0004-project-config-surface.md
[adr-0007]: adr-0007-ticket-hygiene-reinforcement-hooks.md
[cc-monitors]: https://code.claude.com/docs/en/plugins-reference#monitors
