---
id: 02e64942-43c2-4f11-b70c-fcc3625aec52
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-09T00:00:00Z
title: Why github-bug-capture is shaped the way it is
diataxis_type: explanation
---

`github-bug-capture` exists to turn a diagnostic discovered while code is
being written — a failing test, a lint error, a build break, any observed
defect — into a structured, MIF-conformant, lifecycle-managed GitHub issue,
without forcing the discoverer to stop and manually fill out an issue form.
The plugin's own manifest description names this directly: "diagnostics
discovered while code is being written become structured ... GitHub issues."

Two design decisions shape everything else in the plugin. Both are recorded
as accepted Structured MADR ADRs in `docs/decisions/`, and both are load-bearing
for how this plugin's surface is organized.

## Layer 1 (MCP core) vs Layer 2 (progressive enhancement)

[ADR-0001](../../decisions/adr-0001-bug-capture-layer1-core.md) decides how
the plugin's always-on, agent-neutral capability is built. The research
blueprint that spawned this plugin specified a literal gh-CLI-and-Actions
core with "no Claude Code or MCP dependency." This marketplace had already
shipped six sibling plugins on a different house pattern: a portable
TypeScript MCP server as the single hardened core, with Claude Code
skills/hooks/agents layered on top as opt-in enhancement. ADR-0001 chose the
house pattern over the blueprint-literal option, for one reason above the
others: the marketplace's existing `github-client.ts`/`mif.ts` modules
already carry rate-limit classification, deterministic mutation pacing, and
MIF frontmatter discipline — logic that a from-scratch shell reimplementation
would either duplicate badly or skip. Reimplementing it twice (the
dual-parity option ADR-0001 also considered and rejected) guarantees drift
between the two cores over time.

The result is two layers with different guarantees:

- **Layer 1 — the MCP-server core** (`mcp-server/`, documented in
  [reference/tools.md](../reference/tools.md)): the seven tools this plugin
  registers. This is the plugin's single hardened write path — every
  severity, lifecycle, dedup, and capability-detection operation goes
  through it, under the marketplace's usual quality gates (typecheck, lint,
  90% coverage, committed `dist/`, attested release). It requires a Node
  runtime and an MCP host, but no AI assistant.
- **Layer 2 — progressive-enhancement packs**: Claude Code skills
  (`skills/file-bug`, `skills/triage`, `skills/dedup-check`), a hooks
  library (`hooks/`, gated by the fail-closed pack-toggle reader in
  `hooks/lib/settings.mjs` over `.config/gdlc/config.yml`'s `packs:`
  section — missing file, missing section, missing key, or any non-`true`
  value all mean disabled; [ADR-0006](../../decisions/adr-0006-eliminate-markdown-config-carriers.md)
  moved this off the retired `.claude/github-bug-capture.local.md` carrier,
  making pack toggles committed team policy rather than a personal
  per-developer setting), and two sets of copy-in templates: `workflows/` (Actions
  IssueOps templates — auto-label, close-keyword audit) and
  `workflows-gh-aw/` (a GitHub Agentic Workflows batch-triage template,
  explicitly marked technical preview). None of these Layer 2 surfaces ship
  as active automation in this repository itself — `workflows/` and
  `workflows-gh-aw/` are deliberately kept out of `.github/workflows/` so
  they are inert until a consumer copies them into their own repo, and every
  hook checks its pack toggle before acting. Layer 2 gives an agent session
  a smoother path to the same Layer 1 tools; it never contains business
  logic the core lacks.

ADR-0001 frames the blueprint's literal "no MCP dependency" as an intent to
preserve (operable with no AI assistant present), not a literal constraint —
the gh-CLI wrapper library (`scripts/gh-bug.sh`) and the Actions templates
satisfy that intent as thin affordances over the same conventions, without
becoming a second implementation of the pacing/classification/MIF logic.

## Consumer, not owner, of PR-to-issue linkage

[ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md) settles a
boundary question the blueprint didn't anticipate: this marketplace already
ships PR-to-issue linkage (`get_linked_issues`,
`sync_linked_issues_project_field`) as a capability of `github-pull-requests`,
built on retry-hardened handling of GraphQL's `closingIssuesReferences` lag.
The blueprint's triage-skill-pack would have given `github-bug-capture` its
own `link-pr-to-bug` skill and its own copy of that GraphQL. ADR-0002 rejects
that: **linkage stays owned by `github-pull-requests`; `github-bug-capture`
consumes it** through a declared `dependencies` edge in its manifest
(`{ "name": "github-pull-requests" }`), which transitively pulls in
`github-sdlc-planning` as well.

This is why none of the seven tools listed in
[reference/tools.md](../reference/tools.md) touch PR state or linkage at
all — that surface is out of scope by design, not by oversight. When a bug
issue's board Status needs to reflect a merged PR (a PR body saying
`Fixes #N`), that leg is documented as consumption of the PR plugin's
existing tools, not a `github-bug-capture` tool call. The practical
consequence is a deeper dependency chain (bug-capture → pull-requests →
sdlc-planning), which ADR-0002 accepts explicitly because catalog admission
and install-time tests verify the chain resolves, and because a stale middle
link failing loudly is preferable to a second, silently-drifting linkage
implementation.

## Where this plugin's tools stop

Put together, these two decisions draw a tight boundary around what
`github-bug-capture`'s own MCP tools do: agent-neutral severity tagging,
lifecycle-state reads/writes on a triage board, and keyword-based dedup —
nothing that duplicates board governance (owned by `github-sdlc-planning`)
or PR linkage (owned by `github-pull-requests`). `get_agent_capabilities`
(the first tool in [reference/tools.md](../reference/tools.md)) reports this
explicitly via its `composesWith: ['github-pull-requests',
'github-sdlc-planning']` field, so any MCP host or sibling plugin can detect
the composition without reading these ADRs.

## ADR audit

| ADR | Title | Relevance to this plugin |
| --- | --- | --- |
| [ADR-0001](../../decisions/adr-0001-bug-capture-layer1-core.md) | MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1 | Primary — defines this plugin's own Layer 1/Layer 2 split and the seven tools in the MCP core. |
| [ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md) | PR-to-Issue Linkage Stays in github-pull-requests; github-bug-capture Consumes It | Consumer note — explains why this plugin has no linkage tools and depends on `github-pull-requests`. |
| [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md) | Rely on Native Projects v2 Workflows for Status Hygiene; Add a Hook Only for the In-Progress Gap | Not directly relevant — ADR-0003 governs `github-sdlc-planning`'s own board-status hook, not this plugin's tools. Mentioned here only because `set_lifecycle_state`/`get_lifecycle_state` read the same Status field that native Projects v2 workflows (covered by ADR-0003) can also move. |
