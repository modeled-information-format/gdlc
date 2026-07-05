---
id: c867194d-1baa-48c1-869e-5c8d43362ff7
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/github-sdlc-planning
modified: 2026-07-05T00:00:00Z
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

## Agent

`project-setup` — six-stage pipeline: classify intent → resolve template
(`copyProjectV2` or blank `createProjectV2`, never a `templateId`) → configure
fields → seed draft issues → wire automations → report.

## Hooks

Board-status hygiene (see
[ADR-0003](../../docs/decisions/adr-0003-board-status-hygiene.md)) relies on
GitHub's own Projects v2 built-in workflows for Todo-on-add and
Done-on-close/merge. The one gap those workflows leave, marking an issue In
Progress before a PR exists, is closed by the `set-in-progress` `PostToolUse`
hook (matcher `mcp__github-sdlc-planning__(add_sub_issue|update_issue)`).

The hook is gated on a per-project settings file,
`.claude/github-sdlc-planning.local.md` (same convention as
`github-bug-capture`'s pack toggles; keep it out of version control via
the consuming project's .gitignore or .git/info/exclude):

```markdown
---
board:
  projectOwnerLogin: acme
  projectNumber: 4
  projectOwnerType: organization
---
```

`projectOwnerType` defaults to `organization` when omitted (`user` is also
accepted). A missing file, a missing `board:` map, or a missing/invalid key
means the hook is disabled: it always emits an empty response rather than
erroring.

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
