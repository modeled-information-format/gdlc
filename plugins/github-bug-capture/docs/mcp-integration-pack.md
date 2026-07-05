# The mcp-integration pack — always-on by construction

## What the blueprint asked for

The `github-ai-bug-tracking-plugin` research blueprint (2026-06-28) specifies
a gh-wrapper-first Layer 1 core with an opt-in `mcp-integration` pack as one
of the Layer 2 AI-enhancement packs: for a shell-first core, wiring up an MCP
server at all is an enhancement someone can choose not to install.

## Why there is nothing to build here

[ADR-0001](../../../docs/decisions/adr-0001-bug-capture-layer1-core.md) chose
a different Layer 1 architecture for this marketplace: `github-bug-capture`'s
core **is** a portable TypeScript MCP server (`mcp-server/`), on the same
house pattern as this marketplace's other six plugins, with the blueprint's
gh-wrapper and Actions IssueOps surfaces shipped as thin agent-neutral
affordances instead of the primary core.

That decision inverts what "the mcp-integration pack" means:

- In the blueprint's gh-wrapper-first world, MCP wiring is the add-on; a
  consumer who never enables it drives everything through `gh`.
- In this plugin's actual architecture, MCP **is** Layer 1. `.mcp.json` wires
  `mcp-server/dist/index.js` unconditionally, for every install of this
  plugin — there is no code path where it is absent, and no toggle that
  could meaningfully disable it without disabling the plugin's core itself.

Building a second, bolt-on MCP server (or a shim that conditionally starts
the existing one) to satisfy the blueprint's literal pack boundary would
duplicate Layer 1, which is exactly the outcome
[ADR-0001](../../../docs/decisions/adr-0001-bug-capture-layer1-core.md)
rejected for the core itself (its Option 3, "dual-parity cores"). Nothing new
is built for issue #41.

## What the `mcp-integration` toggle actually means here

[`docs/pack-toggles.md`](pack-toggles.md) keeps the `mcp-integration` key in
the four-pack control plane for blueprint traceability and forward
compatibility, but it is documentation-only in this deviation: the
Layer 1 MCP server never consults it (Layer 1 is never gated by any pack
toggle — see `hooks/lib/settings.mjs`'s header comment), and no Layer 2 code
branches on it. Setting `mcp-integration: true` in
`.claude/github-bug-capture.local.md` records that a consumer is relying on
the bundled MCP wiring as their integration surface; setting it `false`
changes nothing observable, since the server still starts. If a future
gh-wrapper-first consumer genuinely needs to run Layer 1 with no MCP runtime
present at all, that consumer already has one: the gh-CLI affordance
(`scripts/gh-bug.sh`) and the Actions IssueOps templates (`workflows/`)
described in [ADR-0001](../../../docs/decisions/adr-0001-bug-capture-layer1-core.md),
neither of which needs this toggle either.

## Cross-references

- [ADR-0001: MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1](../../../docs/decisions/adr-0001-bug-capture-layer1-core.md) — the deviation this pack's absence follows from.
- [`docs/pack-toggles.md`](pack-toggles.md) — the four-pack control plane this toggle is one entry in.
- [`README.md`](../README.md) — the plugin's overall Layer 1/Layer 2 architecture summary.
