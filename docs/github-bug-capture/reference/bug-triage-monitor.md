---
id: 2c3cdd37-8503-4036-9705-93ae8d050a05
type: semantic
created: 2026-07-17T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-17T09:43:41.634Z'
title: bug-triage monitor reference
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

Reference for the `bug-triage` background monitor
([ADR-0010](../../decisions/adr-0010-session-monitors.md)), declared in
`plugins/github-bug-capture/monitors/monitors.json` and implemented by
`monitors/bug-triage.mjs` (entrypoint) + `monitors/lib/bug-triage.mjs`
(checks) + `monitors/lib/monitor-core.mjs` (shared loop harness, byte-copied
from github-sdlc-planning). This is a lookup document — for the why, see
[Hooks vs. monitors](../../explanation/hooks-vs-monitors.md).

## Activation

| Condition | Effect when absent |
| --- | --- |
| `packs.monitors: true` in the resolved `.config/gdlc/config.yml` | Monitor idles (5-minute re-check, zero GitHub calls, zero output) |
| A session pointer for the monitor's cwd (`tmpdir()/gdlc-session-pointer/`) | Cycle skipped silently |
| Issues recorded as created this session (`tmpdir()/gdlc-session-issues/`, written by `hooks/track-created-issues.mjs`) | Nothing to watch; zero API calls |

`track-created-issues.mjs` (monitors-pack-gated) records `create_issue`
touches from `gh issue create`, the generic `github` MCP server, and —
deliberately cross-plugin — `github-sdlc-planning`'s `create_issue` tool,
the normal creation surface where the suite is installed together. The
hygiene family's own scratch cannot serve here: it is cleared at every
turn boundary by design (ADR-0007 AD-3).

## Check

Advisory only. One batched, aliased GraphQL query per cycle covering every
session-created issue.

| Drift | Condition | Nudge (next step) |
| --- | --- | --- |
| Untriaged bug | Issue OPEN, is a bug (native type `Bug`, or a `bug` label, case-insensitive), created ≥ 15 min ago, and no `Severity` single-select value on any of its project items | triage it (`set_severity`, or the `triage` skill) |

Closed issues, non-bugs, and bugs inside the 15-minute grace period are
silent. "Triaged" means the triage board's `Severity` field
(Critical/High/Medium/Low, see `ensure_severity_field`) has a value.

## Cadence and dedup (constants, v1)

Same harness constants as every ADR-0010 monitor: 90 s ± 20 s poll, 120 s
initial delay, 15-min failure backoff ceiling, 30-min re-emit cooldown,
dedup store `tmpdir()/gdlc-monitor-scratch/<session>-bug-triage.json`
(24 h age-out, 200-entry cap). "Still untriaged" is a persisting condition
throttled by the cooldown; assigning a Severity simply ends it.

## Scope

Session-scoped by design (ADR-0010 AD-8): bugs filed outside a monitored
session are the territory of the `triage` and `milestone-triage` skills,
not this monitor. The issue-side `projectItems` connection can omit items
on a board owned by a different entity than the issue's repo (issue #273)
— a false "untriaged" nudge at worst; `set_severity`'s project-side scan
remains the source of truth.
