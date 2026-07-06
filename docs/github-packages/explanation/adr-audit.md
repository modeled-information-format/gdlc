---
id: 9d919308-960a-4ef9-a1de-07891670572f
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: ADR relevance audit for github-packages
diataxis_type: explanation
---
# ADR relevance audit for github-packages

This repo's three Architectural Decision Records — `docs/decisions/adr-0001
-bug-capture-layer1-core.md`, `adr-0002-pr-issue-linkage-ownership.md`, and
`adr-0003-board-status-hygiene.md` — were each read in full for relevance to
`github-packages`.

**Finding: none apply.** All three ADRs govern `github-bug-capture`
specifically:

- **ADR-0001** decides that `github-bug-capture`'s Layer 1 is an MCP-server
  core with thin `gh` wrappers as affordances.
- **ADR-0002** assigns ownership of PR-to-issue linkage to
  `github-pull-requests`, with `github-bug-capture` as a consumer, never a
  reimplementer.
- **ADR-0003** relies on the org Projects v2 board's native workflows for
  board-status hygiene (Todo-on-add, Done-on-close/merge), again in the
  context of issue/PR/planning tooling.

`github-packages` has no issues, no PRs, and no Projects v2 board
interaction anywhere in its tool set — it is pure package-registry REST.
A text search for "package" across all three ADR files turns up exactly one
match, in ADR-0001's Schedule Risk section ("Scaffold copies an existing
package's toolchain") — a generic reference to an npm package's toolchain
structure, unrelated to the `github-packages` plugin or its domain. No ADR
in this repo currently governs `github-packages`, and none of the three
existing ADRs needed amendment for this audit.
