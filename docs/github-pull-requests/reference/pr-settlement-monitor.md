---
id: 9cdfe12d-bce8-4dc7-a2d0-5698ce628f8d
type: semantic
created: 2026-07-17T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-17T09:43:18.704Z'
title: pr-settlement monitor reference
diataxis_type: reference
provenance:
  '@type': Provenance
  agent: claude-code/claude-fable-5
  wasGeneratedBy:
    '@id': urn:mif:activity:claude-code-session:09389b7a-b2b1-4088-9b84-424cb64dcedc
    '@type': prov:Activity
  trustLevel: user_stated
  agentVersion: 2.1.212
---

Reference for the `pr-settlement` background monitor
([ADR-0010](../../decisions/adr-0010-session-monitors.md)), declared in
`plugins/github-pull-requests/monitors/monitors.json` and implemented by
`monitors/pr-settlement.mjs` (entrypoint) + `monitors/lib/pr-settlement.mjs`
(checks) + `monitors/lib/monitor-core.mjs` (shared loop harness, byte-copied
from github-sdlc-planning). This is a lookup document — for the why, see
[Hooks vs. monitors](../../explanation/hooks-vs-monitors.md).

## Activation

| Condition | Effect when absent |
| --- | --- |
| `packs.monitors: true` in the resolved `.config/gdlc/config.yml` | Monitor idles (5-minute re-check, zero GitHub calls, zero output) |
| A session pointer for the monitor's cwd (`tmpdir()/gdlc-session-pointer/`) | Cycle skipped silently |
| PRs recorded for this session (`tmpdir()/gdlc-session-prs/`, written by `track-opened-prs.mjs`) | Nothing to watch; zero API calls |

`track-opened-prs.mjs` records PRs when the prLifecycle thread gate is on
**or** the monitors pack is on (ADR-0010 AD-7) — a monitors-only
configuration still populates this monitor's data source.

## Checks

All advisory. One batched, aliased GraphQL query per cycle covering every
session PR (reviewThreads capped at 100 per PR).

| Drift | Condition | Nudge (next step) |
| --- | --- | --- |
| Checks failing | `statusCheckRollup` FAILURE/ERROR on the current head (drafts included) | fix or re-run the checks |
| Changes requested | `reviewDecision` = CHANGES_REQUESTED | address findings, push, re-request review |
| Unresolved threads | ≥ 1 unresolved review thread (count in the dedup key — a rising count re-nudges immediately) | address and resolve every thread |
| Settled | OPEN, not draft, checks SUCCESS, APPROVED, zero unresolved threads | merge it |
| Merged | `merged: true` (one-time) | verify linked issues closed and board Status Done |

Closed-unmerged PRs and pending checks are silent. Draft PRs get only the
checks-failing signal.

## Cadence and dedup (constants, v1)

Same harness constants as every ADR-0010 monitor: 90 s ± 20 s poll, 120 s
initial delay, 15-min failure backoff ceiling, 30-min re-emit cooldown,
dedup store `tmpdir()/gdlc-monitor-scratch/<session>-pr-settlement.json`
(24 h age-out, 200-entry cap). Keys embed the head sha (and thread count),
so a push or a new thread re-arms immediately. All fresh findings in one
cycle collapse into a single `gdlc pr-settlement: ...` notification line.

## Relationship to the event-driven gates

`review-thread-gate.mjs` (PreToolUse) **blocks** new branch/worktree work
while session PRs carry unresolved threads — but only at the moment new
work starts. This monitor covers the complementary case: the review that
lands while the session is mid-task, with no gating tool call in sight.
The two read the same `gdlc-session-prs` scratch and never conflict.
