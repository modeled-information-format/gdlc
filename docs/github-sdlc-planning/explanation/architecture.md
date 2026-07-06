---
id: 3c476b9f-2d8c-460f-86ed-e94ca6fd225b
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-sdlc-planning exists and how it's built
diataxis_type: explanation
---


## Its role as the Tier-1 foundation

`github-sdlc-planning` is the marketplace's foundation plugin: Issues,
native sub-issues, Projects v2, Milestones, and Discussions. Every other
domain plugin in this marketplace either depends on it directly or
transitively:

- `github-pull-requests` depends on `github-sdlc-planning` (its manifest
  declares the edge) — PR classification and PR-to-project coupling reuse
  planning's MIF reader and board tools.
- `github-bug-capture` depends on `github-pull-requests`, and therefore
  transitively on `github-sdlc-planning` — see
  [ADR-0001](../../decisions/adr-0001-bug-capture-layer1-core.md) and
  [ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md).

`github-repo-config`, `github-insights`, `github-packages`, and
`github-org-identity` are standalone and do not depend on planning. The
dependency graph is one-directional and rooted here: if
`github-sdlc-planning` is broken or its manifest version drifts, every
plugin above it in the chain is affected (the "mif-docs staleness incident
of 2026-07-05," referenced in ADR-0002, is a documented real instance of
this failure mode for a different dependency edge in the same marketplace).

Concretely, this plugin owns:

- **Issues**: create/update, with MIF frontmatter authored automatically.
- **Native sub-issues**: GitHub's real parent/child issue relationship
  (`addSubIssue`), not a task-list checkbox convention — bounded at 100
  children per parent and 8 nesting levels.
- **Projects v2**: adding items, setting field values, reading board state.
- **Milestones**: full REST-backed lifecycle (GraphQL exposes milestones
  read-only).
- **Discussions**: create and list.
- **A portable session/capability floor** (`get_session_context`,
  `get_agent_capabilities`) for any MCP host that isn't Claude Code and
  therefore has no `SessionStart` hook to lean on.

## Architecture: MCP-server core + progressive-enhancement layer

The plugin is built on the marketplace's house pattern, described in its own
[README](../../../plugins/github-sdlc-planning/README.md) and confirmed by
ADR-0001 as the pattern the rest of the marketplace follows too:

1. **The MCP-server core** (`mcp-server/src/`) is a portable TypeScript
   server exposing all 16 tools over stdio (`@modelcontextprotocol/sdk`).
   It has zero dependency on Claude Code: any MCP-capable host (Cursor,
   Gemini CLI, Copilot, Codex, or a bare `gh`-authenticated script talking
   MCP) drives the exact same tool surface. Shared infrastructure lives in
   `github-client.ts` (token resolution with an env-var-then-`gh`-fallback
   chain, deterministic mutation pacing at a hard 1-second minimum interval
   between content-creating calls, and three-way 403 classification —
   secondary rate limit vs. primary budget exhaustion vs. plain permission
   denial) and `resolvers.ts` (node-ID resolution for issues/repos/projects,
   since Projects v2 mutations require GraphQL node IDs, never numeric
   issue/project numbers). `mif.ts` implements MIF L1 frontmatter
   formatting/parsing natively in this layer — deliberately not delegated to
   the `mif-docs` skill set, because every MCP host needs identical body
   framing regardless of whether it has any Claude Code skill installed.
2. **The progressive-enhancement layer** sits on top, Claude-Code-specific,
   and is optional:
   - **Skills**: `project-setup`, `epic-decomposition`, `sprint-plan`,
     `milestone-triage`, `template-gallery` — each a higher-level workflow
     built from the same 16 tools.
   - **An agent**: `project-setup`'s six-stage pipeline (classify intent →
     resolve template → configure fields → seed draft issues → wire
     automations → report).
   - **Hooks**: `session-start.mjs` (injects open milestones as session
     context, the Claude Code equivalent of calling `get_session_context`
     manually), `validate-mif.mjs` (MIF frontmatter conformance),
     `confirm-mutation.mjs` (a confirmation prompt before certain board
     mutations), and `set-in-progress.mjs` (see ADR-0003 below).

A host with no hooks support is not degraded to "broken" — it is degraded to
"do the equivalent thing via an explicit tool call," which is exactly what
`get_session_context` and `get_agent_capabilities` exist for
(`getAgentCapabilities()` returns `hooksSupported: false` precisely to make
this explicit and discoverable at runtime).

## ADR audit: which decisions govern this plugin

Three ADRs exist under `docs/decisions/` as of this writing. Only one makes
a decision specifically about `github-sdlc-planning`'s own tool behavior:

| ADR | Title | Relevance to this plugin |
| --- | --- | --- |
| [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md) | Rely on Native Projects v2 Workflows for Status Hygiene; Add a Hook Only for the In-Progress Gap | **Directly governs this plugin.** It decided (a) `add_item_to_project` must query for an existing board item before mutating, returning `existed: true` instead of creating a duplicate — implemented in `mcp-server/src/tools/projects.ts`; and (b) the `set-in-progress` `PostToolUse` hook in this plugin's own `hooks/` directory, which fires on `add_sub_issue`/`update_issue` and calls the equivalent of `set_field_value` to move a board item to In Progress. Status: accepted, implemented, and audited compliant. |
| [ADR-0001](../../decisions/adr-0001-bug-capture-layer1-core.md) | MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1 | **Not specific to this plugin.** It decides `github-bug-capture`'s own architecture. It references `github-sdlc-planning` only as prior art for the house pattern this plugin already established — no requirement in the ADR's Decision changes anything in `github-sdlc-planning`'s code. |
| [ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md) | PR-to-Issue Linkage Stays in github-pull-requests; github-bug-capture Consumes It | **Not specific to this plugin.** It settles a boundary between `github-pull-requests` and `github-bug-capture`. `github-sdlc-planning` is mentioned only as the root of the transitive dependency chain (`bug-capture → pull-requests → sdlc-planning`) whose fragility the ADR flags as a risk — it imposes no decision on this plugin's own tools. |

If a future ADR is warranted for a `github-sdlc-planning`-specific decision
not yet recorded (for example, formalizing the 100-sub-issue / 8-level
nesting limits as a decision rather than an implementation detail), that gap
is noted here rather than an ADR being authored as part of this
documentation task.
