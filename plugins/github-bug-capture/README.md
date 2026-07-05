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

The remaining Layer 1 core tools (bug filing, dedup) and the lifecycle tools
land with epic #33. `get_agent_capabilities().tools` is always the
authoritative list.

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
