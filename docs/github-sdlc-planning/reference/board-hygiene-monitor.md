---
id: 25ac49cb-b1fd-4bae-a05a-69832a020155
type: semantic
created: 2026-07-17T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-17T09:42:57.977Z'
title: board-hygiene monitor reference
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

Reference for the `board-hygiene` background monitor
([ADR-0010](../../decisions/adr-0010-session-monitors.md)), declared in
`plugins/github-sdlc-planning/monitors/monitors.json` and implemented by
`monitors/board-hygiene.mjs` (entrypoint) + `monitors/lib/board-hygiene.mjs`
(checks) + `monitors/lib/monitor-core.mjs` (shared loop harness). This is a
lookup document — for the why, see
[Hooks vs. monitors](../../explanation/hooks-vs-monitors.md).

## Activation

| Condition | Effect when absent |
| --- | --- |
| `packs.monitors: true` in the resolved `.config/gdlc/config.yml` | Monitor idles (5-minute re-check, zero GitHub calls, zero output) |
| A session pointer for the monitor's cwd (`tmpdir()/gdlc-session-pointer/`, written by this plugin's hooks) | Cycle skipped silently |
| An active issue recorded for the session+cwd (`tmpdir()/gdlc-first-edit/`, written by `set-in-progress.mjs`) | Nothing to watch; no findings |
| A `board:` section in the resolved config | Board checks skipped; git-staleness check still runs |

Runs only in interactive CLI sessions on hosts with Monitor support; the
process starts at session start and re-checks the pack every cycle, so a
mid-session `packs.monitors: true` takes effect within ~5 minutes.

## Checks

All advisory — this monitor never mutates board state (ADR-0003's
single-writer invariant). One batched GraphQL query per cycle; matching
against the configured board is by project number + owner login.

| Drift | Condition | Nudge (next step) |
| --- | --- | --- |
| Still Todo | Issue OPEN, on the board, Status `Todo`/unset while the session works it | set Status to In Progress |
| Closed, not Done | Issue CLOSED, on the board, Status ≠ `Done` | set Status to Done (or reopen) |
| Done, still open | Issue OPEN, Status `Done` | close the issue or correct Status |
| Blocked, unexplained | Status `Blocked`, no issue comment since the item last changed | comment the blocker |
| In Review, no PR | Issue OPEN, Status `In Review`, no OPEN/MERGED PR in `closedByPullRequestsReferences` | open the PR or move Status back |
| Uncommitted work | `git status --porcelain` output non-empty and unchanged ≥ 30 min | commit or stash |

## Cadence and dedup (constants, v1)

| Constant | Value |
| --- | --- |
| Poll interval | 90 s ± 20 s jitter |
| First assessment | 120 s after start |
| Failure backoff | exponential to 15 min |
| Re-emit cooldown (same condition) | 30 min |
| Git staleness threshold | 30 min |
| Dedup store | `tmpdir()/gdlc-monitor-scratch/<session>-board-hygiene.json`, 24 h age-out, 200-entry cap |

A changed condition (new status value, new dirty-since clock) produces a
new dedup key and re-arms immediately. All fresh findings in one cycle
collapse into a single `gdlc board-hygiene: ...` notification line.

## Known limitations

- Issue-side `projectItems` can omit items on a board owned by a different
  entity than the issue's repo — a false "not on board"/unset reading;
  advisory cost only.
- The Blocked check proxies "since the status change" with the project
  item's own `updatedAt`.
- Concurrent sessions in one directory resolve last-writer-wins (see
  ADR-0010 AD-3).
