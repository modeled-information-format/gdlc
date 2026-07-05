# github-bug-capture

Development-time bug capture for GitHub: diagnostics discovered while code is
being written become structured, MIF-conformant, lifecycle-managed GitHub
issues — before the CI or production boundary.

Realizes the BUILD decision of the `github-ai-bug-tracking-plugin` research
deliverable (2026-06-28) as this marketplace's seventh plugin. Tracked by
epics [#28](https://github.com/modeled-information-format/gdlc/issues/28),
[#33](https://github.com/modeled-information-format/gdlc/issues/33),
[#38](https://github.com/modeled-information-format/gdlc/issues/38), and
[#43](https://github.com/modeled-information-format/gdlc/issues/43).

## Architecture: two layers

**Layer 1 — agent-neutral core (always on).** A portable TypeScript MCP
server (`mcp-server/`) any MCP host can drive, plus agent-neutral
affordances: a gh-CLI wrapper library and an Actions IssueOps workflow
library. See [ADR-0001](../../docs/decisions/adr-0001-bug-capture-layer1-core.md)
for why the core is MCP-shaped rather than the research blueprint's literal
gh-wrapper core — a documented deviation that keeps rate-limit
classification, mutation pacing, and MIF frontmatter in one hardened,
gate-covered implementation.

**Layer 2 — AI-assistant enhancement packs (opt-in).** Claude Code packs
(hooks-pack diagnostic capture, triage skills, GitHub-MCP wiring, gh-aw
batch workflows) that enhance the core without changing it. Each pack is
individually toggleable — see *Pack toggles* below.

## Composition (ADR-0002)

This plugin deliberately does **not** reimplement capabilities its siblings
own:

- **PR-to-issue linkage** (close-keyword reads, linked-issue queries,
  project-field sync) is consumed from
  [`github-pull-requests`](../github-pull-requests/README.md) — see
  [ADR-0002](../../docs/decisions/adr-0002-pr-issue-linkage-ownership.md).
- **Planning governance** (milestones, sprints, Projects v2 boards) stays
  with [`github-sdlc-planning`](../github-sdlc-planning/README.md): this
  plugin files and classifies a bug; the planning plugin decides which
  milestone or sprint it lands in.

The manifest declares `dependencies: [{ "name": "github-pull-requests" }]`,
which transitively brings in `github-sdlc-planning`.

## Tool surface

| Tool | Purpose |
| --- | --- |
| `get_agent_capabilities` | Feature detection: tool surface, MIF conformance level, composition boundary. |
| `ensure_severity_field` | Ensure the triage board has a `Severity` single-select field (Critical/High/Medium/Low), creating it if absent. Idempotent. |
| `set_severity` | Set an issue's `Severity` value on the triage board; typed errors when the issue is not on the board or the field/option is missing. |
| `get_lifecycle_state` | Read an issue's lifecycle state: native GitHub state (open/closed) plus the triage board's `Status` value, if the issue is on that board. |
| `set_lifecycle_state` | Set an issue's `Status` value on the triage board; optionally closes the issue afterward when `closeIfDone` is true. |
| `search_similar_issues` | Find candidate duplicate issues via the REST search/issues endpoint (plain keyword search). |
| `close_as_duplicate` | Close an issue with `state_reason: duplicate` and comment linking to the canonical issue. |

The remaining Layer 1 core tool (bug filing) lands with epic #28.
`get_agent_capabilities().tools` is always the authoritative list.

## Bug lifecycle (epic #33)

**Severity ([#34](https://github.com/modeled-information-format/gdlc/issues/34)).**
Delivered by the triage-board tools above (`ensure_severity_field` /
`set_severity`): a `Severity` single-select field (Critical/High/Medium/Low)
on the triage board.

**Lifecycle state mapping ([#35](https://github.com/modeled-information-format/gdlc/issues/35)).**
`get_lifecycle_state` / `set_lifecycle_state` read and write the composite of
native GitHub issue state (open/closed) and the triage board's `Status`
single-select value. The research blueprint's five conceptual states (Open,
Triaged, In Progress, Resolved, Closed) are a mapping a caller applies onto
this composite: the tools resolve the board's actual `Status` options
dynamically rather than assuming specific option names, and fail with a
typed error (`missing_field` / `missing_option`) if the board has no
`Status` field or the requested value isn't one of its options.
`set_lifecycle_state`'s `closeIfDone` flag closes the underlying issue once
the caller considers the status it just set to be terminal.

**Deduplication ([#36](https://github.com/modeled-information-format/gdlc/issues/36)).**
`search_similar_issues` is a plain REST keyword search (`GET /search/issues`)
for duplicate candidates, deliberately not AI/embedding similarity, which
the research report flags as a separate, out-of-scope concern.
`close_as_duplicate` closes an issue with `state_reason: duplicate` via the
REST PATCH endpoint and posts a comment linking to the canonical issue.

**PR/commit close-keyword linkage ([#37](https://github.com/modeled-information-format/gdlc/issues/37)), composed with `github-pull-requests`.**
A merged pull request whose body contains a close keyword (`Fixes #N`,
`Closes #N`) closes the referenced bug through GitHub's native behavior;
no code in this plugin is involved in that leg. To read or sync that state
from this plugin's side, use `github-pull-requests`' own tools:
`get_linked_issues` (closingIssuesReferences, with a Timeline/text-parsing
fallback) and `sync_linked_issues_project_field` (propagates a merged PR's
linked-issue closure onto a Projects v2 field). Per
[ADR-0002](../../docs/decisions/adr-0002-pr-issue-linkage-ownership.md), this
plugin does not reimplement linkage; the manifest's existing
`dependencies: [{ "name": "github-pull-requests" }]` is what makes those
tools available wherever this plugin is installed.

## gh CLI affordance

[`scripts/gh-bug.sh`](scripts/gh-bug.sh) is the agent-neutral shell surface
of Layer 1 (ADR-0001): a bash function library over `gh issue ...` that any
operator or CI job can drive with no MCP runtime present. It applies the
plugin's conventions — the `bug` label plus exactly one
`severity:<critical|high|medium|low>` label, and the MIF L1 comment block
(`mif-id` / `mif-type: Bug` / `mif-ns`) prepended to created bodies — and
passes `--repo`, `--json`, and every unrecognized flag through to `gh`
unchanged.

```bash
source scripts/gh-bug.sh

bug_create --title "Crash on save" --body "steps to reproduce..." \
  --severity high --ns myproject --id crash-on-save --repo owner/repo
bug_edit 42 --severity critical --repo owner/repo   # swaps the severity:* label
bug_close 42 --comment "fixed in #43" --repo owner/repo
bug_list --severity high --json number,title --repo owner/repo
```

Deliberately thin (argument shaping only): no retry, pacing, or dedup logic —
that lives once, in the MCP server. Point bulk or automated operations at the
MCP tools or at the [Actions IssueOps templates](workflows/README.md), the
CI-side substrate of the same layer.

## Org provisioning

The org-wide `Bug` issue type and the severity/priority typed issue fields
(GitHub public preview) are one-time org configuration, not plugin
runtime — see [docs/org-provisioning.md](docs/org-provisioning.md) for the
verified current state, detection commands, and the manual (org-owner-only)
provisioning steps.

## Pack toggles

Layer 2 packs are configured per project in
`.claude/github-bug-capture.local.md` (YAML frontmatter, gitignored). Every
pack defaults to **off**; the core works with all packs disabled. See
[docs/pack-toggles.md](docs/pack-toggles.md) for the file format and per-pack
semantics.

## Development

```bash
cd mcp-server
npm ci
npm run typecheck && npm run lint && npm run test:coverage   # gates (90% coverage)
npm run build        # bundles to dist/index.js — commit dist/ with src/ changes
npm run verify:live  # real implementation, no mocks
```

`dist/` is committed, not gitignored: Claude Code installs plugins from git
source with no build step, and `.mcp.json` runs `node mcp-server/dist/index.js`
directly.
