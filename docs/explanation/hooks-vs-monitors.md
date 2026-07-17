---
id: d670f7e8-efe3-4efc-a718-c0354ed5e018
type: semantic
created: 2026-07-17T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-17T09:44:14.443Z'
title: "Hooks vs. monitors: two halves of ticket-hygiene reinforcement"
diataxis_type: explanation
provenance:
  '@type': Provenance
  agent: claude-code/claude-fable-5
  wasGeneratedBy:
    '@id': urn:mif:activity:claude-code-session:09389b7a-b2b1-4088-9b84-424cb64dcedc
    '@type': prov:Activity
  trustLevel: user_stated
  agentVersion: 2.1.212
---

The github-sdlc-plugins suite reinforces ticket hygiene through two
deliberately different mechanisms: **event-driven hooks**
([ADR-0007](../decisions/adr-0007-ticket-hygiene-reinforcement-hooks.md),
[ADR-0003](../decisions/adr-0003-board-status-hygiene.md)) and
**time-driven session monitors**
([ADR-0010](../decisions/adr-0010-session-monitors.md)). This page
explains why both exist and where the line between them runs.

## The gap hooks cannot see

A hook observes one tool call, at the moment it happens. That makes hooks
the right tool for everything that IS a tool call: a PR being opened
without local review, a Status mutation with no paired lifecycle comment,
a mutating call that deserves a confirmation prompt. Every one of those
has a precise moment to react at, with the call's own `tool_name` and
`tool_input` in hand.

But most hygiene drift is defined by the *absence* of events:

- an issue sits In Progress while the working tree's uncommitted changes
  go stale — no tool call announces "the code was never committed";
- a Copilot review lands on a PR the session opened an hour ago — GitHub
  knows, but no local event fires; `review-thread-gate.mjs` only checks
  when NEW branch work starts;
- the native Item-closed board workflow fails or races, leaving a closed
  issue not-Done forever — and no later call ever touches that issue;
- a bug filed by the diagnostic-capture flow simply never gets a Severity.

No matcher pattern catches an event that never happens. A clock does.

## The division of labor

| Concern | Mechanism | Why |
| --- | --- | --- |
| React to a touch (validate, remind, confirm, gate) | Hook | The event carries the context; latency matters; 15 s budget |
| Mutate board state (the one In-Progress flip) | Hook (`set-in-progress.mjs`, ADR-0003) | Single-writer invariant; a monitor never mutates |
| Detect drift between events; shepherd the next lifecycle step | Monitor (`board-hygiene`, `pr-settlement`, `bug-triage`) | Only a clock triggers on non-events |
| Bridge sessions to monitors | Hook-written pointer files | Hooks have `session_id`; monitors only have a cwd |

The two halves share state in exactly one direction: hooks write
session-scoped scratch (the active issue, the opened PRs, the created
issues, the cwd→session pointer), monitors read it. A monitor is a pure
consumer — if every monitor died, no hook would notice; if the hooks were
disabled, the monitors would idle silently with nothing to watch.

## Why monitors are advisory-only and opt-in

ADR-0007 established (against 2026 industry data on review fatigue) that
advisory beats blocking wherever a check is best-effort. Monitors inherit
that in a stronger form: their checks run on a 90-second poll against a
remote system, so every observation is already slightly stale — acting on
it automatically would race the model itself. Instead each finding is one
terse notification line ("next step: ...") deduplicated by observed state,
so the acting model hears about a drift exactly once per state, and a
changed state (a push, a new thread) re-arms the nudge immediately.

Monitors ship behind `packs.monitors: false` because they are built on an
experimental Claude Code component and because a background process
polling GitHub on the user's auth is something to choose, not inherit.
Enabling the pack mid-session works: monitors re-check it every cycle and
wake within minutes ([configure-gdlc](../github-sdlc-planning/reference/tools.md)
can flip it conversationally).

## What monitors deliberately do not do

- **Mutate anything.** The nudge's addressee — the acting model — holds
  the tools and the judgment; the monitor holds only the clock.
- **Watch the whole board.** All three monitors are session-scoped; board-
  wide sweeps belong to the `triage`/`milestone-triage` skills or a future
  org-side scheduled workflow (ADR-0010, Option 3).
- **Duplicate an event-time check.** The In-Review suggestion at PR-open
  time stays in the hygiene hook; the monitor only reports the drift that
  *persists* afterward.
