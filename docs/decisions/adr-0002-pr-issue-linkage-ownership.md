---
title: "PR-to-Issue Linkage Stays in github-pull-requests; github-bug-capture Consumes It"
description: "PR-to-issue linkage remains solely owned by github-pull-requests; github-bug-capture consumes it through a same-marketplace dependency instead of shipping the blueprint's link-pr-to-bug skill or duplicating the linkage GraphQL."
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
  - pull-requests
  - plugin-composition
status: proposed
created: 2026-07-05
updated: 2026-07-05
author: MIF Maintainers
project: gdlc
technologies:
  - typescript
  - mcp
  - github-graphql
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0001-bug-capture-layer1-core.md
---

# ADR-0002: PR-to-Issue Linkage Stays in github-pull-requests; github-bug-capture Consumes It

## Status

Proposed

## Context

### Background and Problem Statement

The bug-capture blueprint assigns a `link-pr-to-bug` skill to the new plugin's
triage-skill-pack. But this marketplace already ships PR-to-issue linkage as a
core capability of the `github-pull-requests` plugin: `get_linked_issues`
(closingIssuesReferences with read-after-write retry),
`sync_linked_issues_project_field`, and PR classification — built on the
planning plugin's shared MIF reader through a real, catalog-verified
`dependencies` edge. Filing bugs (epic #33, issue #37) needs close-keyword
linkage in its lifecycle: a merged PR whose body says `Fixes #N` should close
the bug and the triage board should reflect it. The boundary question — who
owns linkage — must be settled before the bug plugin's skills and lifecycle
tooling are written, or the marketplace ends up with two implementations of
the same GraphQL surface.

### Current Limitations

1. **Blueprint/marketplace collision**: the blueprint predates this
   marketplace's `github-pull-requests` plugin and assigns linkage to the bug
   plugin; following it literally duplicates shipped, live-verified code.
2. **Read-after-write subtlety is easy to get wrong**: `closingIssuesReferences`
   lags PR mutations; the existing implementation already carries the retry
   discipline a naive re-implementation would miss.

## Decision Drivers

### Primary Decision Drivers

The following factors are weighted most heavily in this decision:

1. **No duplicated surface**: when two plugins in this catalog need the same
   GitHub capability, the capability shall live in exactly one plugin and be
   consumed through a declared `dependencies` edge.
2. **Separation of concerns**: the bug-capture plugin shall own capture,
   classification, and lifecycle of bug issues; PR mechanics (linkage reads,
   review routing, project coupling) shall remain with the PR-domain plugin.

### Secondary Decision Drivers

The following factors influenced the decision but were not individually
decisive:

1. **Dependency mechanics are proven**: same-marketplace edges
   (`github-pull-requests` → `github-sdlc-planning`) are already verified by
   catalog admission and install-time tests.
2. **Blueprint traceability**: the deviation from the blueprint's
   triage-skill-pack contents should be explicit and documented.

## Considered Options

### Option 1: Linkage stays in github-pull-requests; bug-capture consumes it

**Description**: `github-bug-capture` declares a same-marketplace dependency
on `github-pull-requests` (alongside its dependency on
`github-sdlc-planning`). Its lifecycle tooling and skills call the existing
`get_linked_issues` / `sync_linked_issues_project_field` tools; the
triage-skill-pack ships without a `link-pr-to-bug` skill and documents the
composition instead.

**Technical Characteristics**:

- Zero new linkage code; one new manifest `dependencies` entry.
- Bug lifecycle documentation points at the PR plugin's tools for the
  PR-merge → issue-close leg.

**Advantages**:

- Satisfies both primary drivers outright; reuses the retry-hardened
  implementation.
- Enabling the bug plugin transitively enables linkage (dependency
  resolution), so the composed behavior is installable as a unit.

**Disadvantages**:

- The bug plugin cannot function fully without `github-pull-requests`
  installed; the dependency chain deepens by one edge.

**Risk Assessment**:

- **Technical Risk**: Low. The consumed tools are live-verified today.
- **Schedule Risk**: Low. Removes work from the triage-skill-pack.
- **Ecosystem Risk**: Low. Same-marketplace dependency, catalog-verified.

### Option 2: Blueprint-literal — triage-skill-pack ships link-pr-to-bug

**Description**: The bug plugin implements its own linkage skill and the
GraphQL reads behind it, as the blueprint specifies.

**Technical Characteristics**:

- New `link-pr-to-bug` skill plus supporting linkage queries inside
  `github-bug-capture`.

**Advantages**:

- Bug plugin is self-contained for linkage; maximal blueprint fidelity.

**Disadvantages**:

- Duplicates `closingIssuesReferences` handling, including the
  read-after-write retry discipline, creating a second copy to maintain and
  test.

**Disqualifying Factor**: violates the no-duplicated-surface driver — the
capability exists, shipped and live-verified, one dependency edge away.

**Risk Assessment**:

- **Technical Risk**: Medium. A second linkage implementation will drift.
- **Schedule Risk**: Medium. Re-tests an already-tested surface to the 90%
  bar.
- **Ecosystem Risk**: Low.

### Option 3: Move linkage into github-bug-capture; pull-requests consumes it

**Description**: Relocate the linkage tools out of `github-pull-requests`
into the new plugin and reverse the dependency.

**Technical Characteristics**:

- Breaking change to `github-pull-requests`' tool surface; dependency
  direction flips.

**Advantages**:

- Matches the blueprint's mental model of linkage as a bug-lifecycle concern.

**Disadvantages**:

- Breaks a shipped plugin's public surface for consumers that use linkage
  without bug capture; linkage is a PR-domain read regardless of what
  consumes it.

**Disqualifying Factor**: violates separation of concerns in the opposite
direction — PR mechanics would live in a bug plugin — and imposes a breaking
change with no capability gain.

**Risk Assessment**:

- **Technical Risk**: Medium. Surface migration and deprecation cycle.
- **Schedule Risk**: High. Touches two plugins and their consumers.
- **Ecosystem Risk**: Medium. Breaks existing installs' expectations.

## Decision

We keep PR-to-issue linkage **in `github-pull-requests` and have
`github-bug-capture` consume it (Option 1)**.

The implementation will use:

- **A same-marketplace `dependencies` edge**: `github-bug-capture`'s manifest
  declares `{ "name": "github-pull-requests" }`, which transitively brings in
  `github-sdlc-planning`.
- **Composition documentation, not a skill**: the triage-skill-pack (issue
  #40) ships `file-bug`, `triage`, and `dedup-check`; the PR-merge →
  issue-close leg (issue #37) is documented as consuming
  `get_linked_issues` / `sync_linked_issues_project_field`.

This is a documented deviation from the blueprint's triage-skill-pack
contents, preserving its separation-of-concerns driver with the boundary drawn
where this marketplace already draws it.

## Consequences

### Positive

1. **One linkage implementation**: the retry-hardened
   `closingIssuesReferences` handling stays single-sourced and already
   live-verified.
2. **Smaller bug plugin**: the triage-skill-pack sheds a skill and its test
   burden; epic #33's #37 becomes integration documentation plus verify-live
   coverage instead of new GraphQL code.

### Negative

1. **Deeper dependency chain**: bug-capture → pull-requests → sdlc-planning;
   a stale or missing middle link disables the bug plugin (the mif-docs
   staleness incident of 2026-07-05 shows this failure mode is real);
   mitigated by catalog admission verifying the chain and install-time tests
   exercising it.
2. **Blueprint deviation must be tracked**: mitigated by this ADR and the
   plugin README's composition section.

### Neutral

1. **Install weight**: installing bug-capture pulls two sibling plugins; they
   are the plugins a bug-lifecycle consumer wants anyway.

## Decision Outcome

The decision achieves its primary objective — exactly one linkage surface in
the catalog — measured by: zero linkage-related GraphQL queries inside
`github-bug-capture` at review time; a catalog-admission-verified dependency
edge; and the composition verify-live script (issue #48) exercising
file-bug → PR → merge → linked-issue-close through the consumed tools.

Mitigations:

- Dependency-chain fragility covered by install-time dependency tests and
  catalog admission.
- Deviation traceability covered by this ADR.

## Related Decisions

- [ADR-0001: MCP-Server Core for github-bug-capture Layer 1][adr-0001] - the
  core that consumes this boundary.

## Links

- [github-pull-requests plugin README][pr-plugin] - the owning plugin's tool
  surface.

## More Information

- **Date:** 2026-07-05
- **Source:** Epic #43 (issue #45); research deliverable
  `github-ai-bug-tracking-plugin` (2026-06-28)
- **Related ADRs:** ADR-0001

## Audit

### 2026-07-05

**Status:** Pending

**Findings:**

| Finding                                        | Files | Lines | Assessment |
| ---------------------------------------------- | ----- | ----- | ---------- |
| Drafted as proposed; awaiting maintainer review | -     | -     | pending    |

**Summary:** Drafted with Option 1 recommended; the decision is not binding
until the status moves to accepted.

**Action Required:** Maintainer review; on acceptance, issues #37, #40, and
#46 implement against this boundary.

[adr-0001]: adr-0001-bug-capture-layer1-core.md
[pr-plugin]: ../../plugins/github-pull-requests/README.md
