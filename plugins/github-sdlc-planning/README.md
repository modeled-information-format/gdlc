---
id: c867194d-1baa-48c1-869e-5c8d43362ff7
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/github-sdlc-planning
modified: 2026-07-09T00:00:00Z
title: github-sdlc-planning
diataxis_type: reference
---
# github-sdlc-planning

Issues, native sub-issues, Projects v2, Milestones, and Discussions behind a
portable MCP core, so every MCP-capable coding agent (Claude Code, Cursor,
Gemini CLI, Copilot, Codex) drives the full planning surface identically. A
Claude Code progressive-enhancement layer (skills, an agent, hooks) sits on
top. Every issue/discussion body carries MIF-conformant frontmatter, authored
via a dependency on `mif-docs@modeled-information-format`.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-sdlc-planning@github-sdlc-plugins
```

## Auth

Classic PAT with `repo` + `read:org` + `project` scope:

```
gh auth login --scopes project
```

`project` is **not** included in default `gh auth login` scopes — it's
required for every Projects v2 write. Fine-grained PAT equivalent: Issues
(read/write), Projects (read/write), Discussions (read/write), Contents
(read).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `create_issue` / `update_issue` | Issue writes, MIF frontmatter prepended automatically |
| `add_sub_issue` / `list_sub_issues` | Native sub-issue graph (≤100 children, ≤8 nesting levels) |
| `add_item_to_project` / `set_field_value` / `get_project_items` | Projects v2 board operations |
| `create_milestone` / `list_milestones` / `assign_milestone` | Milestone lifecycle |
| `create_discussion` / `list_discussions` | Discussions |
| `get_session_context` / `get_agent_capabilities` | Non-Claude-Code fallback floor |
| `format_mif_issue_body` / `parse_mif_issue_body` | MIF L1 frontmatter (de)serialization |

## Skills

- `project-setup` — "set up a project board", "create a sprint planning
  board", "configure a project for this team"
- `epic-decomposition` — break a high-level goal into epics/stories/tasks
- `sprint-plan` — plan a sprint from backlog + team size + cadence
- `milestone-triage` — review and re-sequence open milestones
- `template-gallery` — list and instantiate curated project templates
- `epic-pipeline` — decompose a goal into a native Epic/Story/Task hierarchy
  and carry it through to a reviewed, merged pull request, composing
  `epic-decomposition`, `github-pull-requests`, `github-bug-capture`,
  `github-repo-config`, `github-insights`, `github-packages`, and
  `github-org-identity` end to end instead of hand-rolled `gh`/GraphQL calls

## Agent

`project-setup` — six-stage pipeline: classify intent → resolve template
(`copyProjectV2` or blank `createProjectV2`, never a `templateId`) → configure
fields → seed draft issues → wire automations → report.

## Hooks

Four hooks make up the Claude-Code-specific enhancement layer. Each is
additive over the portable MCP core (a hook-less host gets the same
behavior via an explicit tool call, never a degraded one):

| Hook | Event / matcher | What it does |
| --- | --- | --- |
| `session-start.mjs` | `SessionStart` (`startup`) | Fetches the repo's open milestones via `gh api` and injects them as session context — the Claude Code equivalent of calling `get_session_context`. |
| `confirm-mutation.mjs` | `PreToolUse`, `mcp__github-sdlc-planning__.*` | Asks for confirmation before any mutating tool call, naming exactly what will change (issue/repo/project) so the prompt is legible instead of a bare tool name. |
| `validate-mif.mjs` | `PostToolUse`, `mcp__github-sdlc-planning__.*` (only acts on `create_issue`/`update_issue`) | Checks the created/updated issue body for a conformant MIF comment block; on failure, returns a correction instruction via `additionalContext`. Discussions are not checked — MIF frontmatter is an issue-body convention only. |
| `set-in-progress.mjs` | `PostToolUse`, `^mcp__github-sdlc-planning__(add_sub_issue|update_issue)$` | Closes the one gap GitHub's native Projects v2 workflows leave (see [ADR-0003](../../docs/decisions/adr-0003-board-status-hygiene.md)): marking an issue In Progress before a PR exists. |

`set-in-progress.mjs` is gated on a board mapping, resolved by
`hooks/lib/in-progress.mjs`'s `readBoardConfig` from two layers, in
order (see [ADR-0004](../../docs/decisions/adr-0004-project-config-surface.md),
[ADR-0006](../../docs/decisions/adr-0006-eliminate-markdown-config-carriers.md),
and [the layered config schema](../../docs/reference/config-schema.md)):

1. The project layer, `.config/gdlc/config.yml`'s `board:` section
   (committed, team-shared).
2. The global layer, `$XDG_CONFIG_HOME/gdlc/config.yml`'s `board:` section
   (default `~/.config/gdlc/config.yml`), if the project layer has none.

The legacy carrier — a `board:` key in `.claude/github-sdlc-planning.local.md`
frontmatter, kept working for one release as a deprecated fallback — was
removed entirely by ADR-0006; a repo still relying on it must migrate the
key into `.config/gdlc/config.yml`.

```yaml
# .config/gdlc/config.yml (project layer; preferred)
board:
  projectOwnerLogin: acme
  projectNumber: 4
  projectOwnerType: organization
```

`projectOwnerType` defaults to `organization` when omitted (`user` is also
accepted). No layer configuring a `board:` section, a configured section
missing/invalid `projectOwnerLogin`/`projectNumber`, or a `projectOwnerType`
that isn't `organization`/`user`/omitted, means the hook is disabled: it
always emits an empty response rather than erroring.

When enabled, the hook fires after `add_sub_issue` (the child issue is the
work item being started) or `update_issue` (skipped when the update closes
the issue, which is a completion signal, not a start-of-work one). It
resolves the issue's item on the configured project and, only if that item
exists and its Status is unset or `Todo`, sets it to `In Progress` via
`updateProjectV2ItemFieldValue`. Items already `In Progress`, `Done`, or any
other status are left alone; an issue not yet on the board is left alone too
(native auto-add may not have run yet). A hook process runs outside the MCP
JSON-RPC session and cannot call `set_field_value` directly, so it shells out
to `gh api graphql` for the same mutation, the same graceful-degradation
path `session-start.mjs` documents. Every failure path (`gh` missing, auth
failure, GraphQL error, malformed input) is a silent no-op.

`add_item_to_project` is idempotent for the same reason ADR-0003 gives:
native auto-add workflows can put an issue on the board before this tool
ever runs, and `addProjectV2ItemById` has no idempotency key of its own. The
tool now checks the issue's existing project items first and returns the
existing item (`existed: true`) instead of creating a duplicate.
