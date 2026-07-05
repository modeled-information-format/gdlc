---
title: "MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1"
description: "Layer 1 of github-bug-capture is a portable TypeScript MCP server on the marketplace house pattern; the gh-CLI wrapper library and Actions IssueOps library ship as thin agent-neutral affordances. A gh-wrapper-first core and a dual-parity core are rejected."
type: adr
conceptType: semantic
x-ontology:
  id: mif-docs
  version: "1.0.0"
  entity_type: decision-record
category: architecture
tags:
  - adr
  - architecture
  - bug-capture
  - mcp
  - plugin
status: accepted
created: 2026-07-05
updated: 2026-07-05
author: MIF Maintainers
project: gdlc
technologies:
  - typescript
  - mcp
  - gh-cli
  - github-actions
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0002-pr-issue-linkage-ownership.md
---

# ADR-0001: MCP-Server Core for the github-bug-capture Plugin's Agent-Neutral Layer 1

## Status

Accepted

## Context

### Background and Problem Statement

The `github-ai-bug-tracking-plugin` research deliverable (report of record +
engineering blueprint, 2026-06-28) reached a BUILD decision for a separate
two-layer bug-capture plugin: an always-on, agent-neutral Layer 1 that any
coding agent, CI process, or shell script can drive, plus opt-in AI-enhancement
packs as Layer 2. The blueprint specifies Layer 1 literally as gh CLI wrappers,
a GitHub Actions IssueOps library, a Projects v2 triage board, and org-wide
issue types/fields, "with no Claude Code or MCP dependency."

This marketplace (`github-sdlc-plugins`) has since shipped six plugins on a
different, proven house pattern: a portable TypeScript MCP server as the core
(usable from any MCP host, exercised by `get_agent_capabilities` /
`get_session_context` feature detection) with Claude Code skills/hooks/agents
as a progressive-enhancement layer, all behind uniform quality gates
(typecheck, lint, 90% coverage, committed bundled `dist/`, attested release).
Before scaffolding `github-bug-capture` (issue #46) or building its Layer 1
core (epic #28), the Layer 1 architecture must be decided: blueprint-literal
gh wrappers, the MCP house pattern, or both in parallel.

### Current Limitations

1. **Two credible "agent-neutral" definitions**: the blueprint means
   shell/CI-neutral (no MCP runtime at all); the house pattern means
   MCP-host-neutral (any MCP client, not just Claude Code). They imply
   different cores.
2. **Proven shared infrastructure is MCP-shaped**: rate-limit classification,
   deterministic mutation pacing, MIF frontmatter authoring, and typed
   `PlanningError` results live in the existing plugins' `github-client.ts` /
   `mif.ts` modules — TypeScript, not shell.
3. **Hooks need in-session tools**: the hooks-pack (issue #39), the plugin's
   differentiator, files issues from inside an agent session; a shell-only
   core would fork the code path the hooks depend on.

## Decision Drivers

### Primary Decision Drivers

The following factors are weighted most heavily in this decision:

1. **Single source of truth**: when a bug issue is filed through any surface,
   the system shall apply the same rate-limit classification, mutation pacing,
   and MIF frontmatter discipline from one implementation, not per-surface
   re-implementations.
2. **Marketplace uniformity**: when the plugin enters this catalog, it shall
   pass the same quality gates (typecheck, lint, 90% coverage, committed
   `dist/` freshness, attested tarball) that govern the six existing plugins.
3. **Agent-neutral operability**: while no AI assistant is present, an
   operator or CI job shall still be able to drive the full bug-issue
   lifecycle (create/edit/close/list) from a shell.

### Secondary Decision Drivers

The following factors influenced the decision but were not individually
decisive:

1. **Blueprint fidelity**: the delivered architecture should be traceable to
   the research blueprint's two-layer intent, documenting deviations
   explicitly.
2. **Composition**: the core should compose with `github-sdlc-planning`
   (milestone/board governance) and `github-pull-requests` (linkage) through
   the same dependency mechanisms the catalog already verifies.

## Considered Options

### Option 1: MCP-server core (house pattern) with agent-neutral affordances

**Description**: Layer 1 is a portable TypeScript MCP server
(`plugins/github-bug-capture/mcp-server`), reusing the marketplace's
github-client/MIF modules. The blueprint's shell/CI surfaces ship as thin
affordances: a gh-CLI wrapper library (issue #29) that calls `gh` directly for
simple lifecycle operations without duplicating business logic, and an Actions
IssueOps workflow library (issue #30) as the CI-side automation substrate.

**Technical Characteristics**:

- One TypeScript implementation of filing, severity, dedup, and lifecycle
  tools; MCP-host-neutral by construction.
- gh wrappers stay thin (label/field conventions only); Actions workflows are
  agent-free automation.

**Advantages**:

- Satisfies the single-source-of-truth and marketplace-uniformity drivers
  directly; hooks-pack calls the same tools any MCP host gets.
- Shell/CI operability preserved through the affordance layer.

**Disadvantages**:

- Shell affordances do not share the TypeScript pacing/classification code;
  their discipline is conventional (labels, sequential `gh` calls), weaker
  than the server's.

**Risk Assessment**:

- **Technical Risk**: Low. The pattern is proven six times in this catalog.
- **Schedule Risk**: Low. Scaffold copies an existing package's toolchain.
- **Ecosystem Risk**: Low. MCP is a Linux Foundation standard; `gh` remains a
  first-class affordance.

### Option 2: gh-CLI wrapper core (blueprint-literal), MCP as a pack

**Description**: Layer 1 is a shell function library over `gh issue ...` plus
the Actions IssueOps library; an MCP server ships only inside the opt-in
mcp-integration pack.

**Technical Characteristics**:

- Core is POSIX shell + GitHub Actions; zero MCP/Node runtime dependency.

**Advantages**:

- Maximal literal fidelity to the blueprint's "no MCP dependency" clause.
- Smallest conceivable install for pure-CI consumers.

**Disadvantages**:

- Re-implements (or forgoes) rate-limit classification, mutation pacing, and
  MIF frontmatter in shell — the exact defect classes the existing
  `github-client.ts` was hardened against.
- The hooks-pack would drive a shell path while every other plugin in the
  marketplace drives MCP tools; quality gates (coverage, typecheck) do not
  apply to a shell core.

**Disqualifying Factor**: fails the single-source-of-truth and marketplace-
uniformity drivers simultaneously — the plugin's most defect-prone logic would
live outside the marketplace's testing and attestation discipline.

**Risk Assessment**:

- **Technical Risk**: High. Shell re-implementation of pacing/classification
  is untyped, untested at the 90% bar, and historically bug-prone.
- **Schedule Risk**: Medium. New shell test tooling would be needed.
- **Ecosystem Risk**: Low.

### Option 3: Dual-parity cores (full MCP server and full shell library)

**Description**: Implement Layer 1 twice at feature parity — a complete MCP
server and a complete shell library — and keep both authoritative.

**Technical Characteristics**:

- Two implementations, two test suites, one behavioral contract.

**Advantages**:

- Every consumer gets a native-feeling core.

**Disadvantages**:

- Permanent double maintenance; behavioral drift between cores is guaranteed
  over time and undetectable without a contract test suite that itself must
  be maintained.

**Disqualifying Factor**: violates the single-source-of-truth driver by
design; the maintenance cost is the blueprint's "zero-core-change
extensibility" inverted.

**Risk Assessment**:

- **Technical Risk**: High. Drift between cores.
- **Schedule Risk**: High. Roughly doubles Layer 1 effort.
- **Ecosystem Risk**: Low.

## Decision

We build `github-bug-capture`'s Layer 1 as an **MCP-server core following the
marketplace house pattern (Option 1)**, with the blueprint's shell/CI surfaces
delivered as thin agent-neutral affordances rather than a second core.

The implementation will use:

- **`plugins/github-bug-capture/mcp-server`**: TypeScript MCP server on the
  same toolchain and gates as the six existing plugins, reusing the
  github-client rate-limit/pacing/MIF discipline.
- **gh-CLI wrapper library (issue #29)**: thin, documented shell functions
  over `gh issue create/edit/close/list --json` applying the plugin's label
  and field conventions; no business logic beyond argument shaping.
- **Actions IssueOps library (issue #30)**: SHA-pinned workflow templates for
  auto-label, dedup, and close-keyword automation — the agent-free substrate.

This is a documented deviation from the blueprint's literal "no MCP
dependency" clause: the deliverable preserves the blueprint's *intent*
(operable with no AI assistant present) through the affordances, while keeping
one hardened implementation of the defect-prone logic.

## Consequences

### Positive

1. **One hardened write path**: pacing, 403 classification, and MIF
   frontmatter live once, under the 90% coverage gate, for every surface that
   matters.
2. **Uniform catalog admission**: the plugin ships through the same
   quality-gates/release/attestation pipeline as its six siblings with no new
   CI machinery.

### Negative

1. **Shell affordance discipline is conventional**: gh wrappers cannot reuse
   the TypeScript pacing code; mitigated by keeping them thin, documenting
   their limits, and pointing bulk operations at the MCP server or Actions
   library.
2. **Blueprint deviation must be tracked**: consumers reading the research
   blueprint will expect a gh-first core; mitigated by this ADR and by the
   plugin README stating the deviation explicitly.

### Neutral

1. **Node runtime requirement**: the core requires Node (as all six existing
   plugins already do); pure-shell consumers use the affordance layer.

## Decision Outcome

The decision achieves its primary objective — one agent-neutral, hardened
Layer 1 — measured by: the bug-capture server passing the marketplace's full
quality gates at admission; the gh wrapper library driving
create/edit/close/list against a sandbox repo with no AI assistant present;
and zero duplicated business-logic modules between the server and the
affordances at review time.

Mitigations:

- Affordance-drift risk covered by documenting the wrappers as conventions,
  not a parallel implementation.
- Blueprint-fidelity risk covered by this ADR's deviation note and README
  cross-reference.

## Related Decisions

- [ADR-0002: PR-to-Issue Linkage Ownership][adr-0002] - fixes the composition
  boundary this core consumes for linkage.

## Links

- [github-ai-bug-tracking-plugin engineering blueprint][blueprint] - the
  two-layer architecture this decision realizes.

## More Information

- **Date:** 2026-07-05
- **Source:** Epic #43 (issue #44); research deliverable
  `github-ai-bug-tracking-plugin` (2026-06-28)
- **Related ADRs:** ADR-0002

## Audit

### 2026-07-05

**Status:** Pending

**Findings:**

| Finding                                        | Files | Lines | Assessment |
| ---------------------------------------------- | ----- | ----- | ---------- |
| Drafted as proposed; awaiting maintainer review | -     | -     | pending    |

**Summary:** Drafted with Option 1 recommended; the decision is not binding
until the status moves to accepted.

**Action Required:** Maintainer review; on acceptance, epic #28 implements the
core against this ADR.

### 2026-07-05

**Status:** Compliant

**Findings:**

| Finding                                                       | Files | Lines | Assessment |
| ------------------------------------------------------------- | ----- | ----- | ---------- |
| MCP-server core shipped (epics #28/#33/#38, PRs #50/#58)       | plugins/github-bug-capture/mcp-server/ | - | compliant |
| gh wrapper library shipped as thin affordance (issue #29)      | plugins/github-bug-capture/scripts/gh-bug.sh | - | compliant |
| Actions IssueOps templates shipped (issue #30)                 | plugins/github-bug-capture/workflows/ | - | compliant |
| No duplicated business logic between core and affordances      | - | - | compliant |

**Summary:** Accepted by the maintainer. Implementation verified before
acceptance: the core passes the marketplace's full quality gates (typecheck,
lint, coverage above the 90% thresholds, committed dist freshness), the gh
wrapper library carries no retry/pacing/business logic beyond argument
shaping and label/MIF conventions, and independent reviews of the delivering
PRs confirmed zero business-logic duplication between the server and the
affordances.

**Action Required:** None; this decision is in force.

[adr-0002]: adr-0002-pr-issue-linkage-ownership.md
[blueprint]: https://github.com/modeled-information-format/gdlc/issues/43
