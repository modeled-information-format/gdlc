---
id: c867194d-1baa-48c1-869e-5c8d43362ff7
type: semantic
created: 2026-07-03T00:00:00Z
namespace: github-sdlc-plugins/github-sdlc-planning
modified: 2026-07-03T00:00:00Z
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
