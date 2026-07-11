---
title: "N-Ancestor, Per-Section Project Config Resolution"
description: "Config resolution now climbs every ancestor with a .config/gdlc/config.yml, resolving board:/packs:/prLifecycle: per-section via each reader's real parser, closing a shadowing bug where a nearer partial config hid a further ancestor's real override."
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
  - configuration
  - xdg
status: accepted
created: 2026-07-11
updated: 2026-07-11
author: MIF Maintainers
project: gdlc
technologies:
  - node
  - typescript
  - xdg-base-directory
  - claude-code-plugins
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0004-project-config-surface.md
  - adr-0005-project-config-cwd-resolution.md
---

# ADR-0008: N-Ancestor, Per-Section Project Config Resolution

## Status

Accepted

## Context

### Background and Problem Statement

ADR-0004 established a two-layer config model: one global layer
(`$XDG_CONFIG_HOME/gdlc/config.yml`) and one project layer
(`.config/gdlc/config.yml`), with per-section wholesale replacement — a
section the project layer defines wins wholly over the same section in the
global layer. ADR-0005 added upward directory search so a cwd *nested inside*
a project root still resolves that project's config, and explicitly named "an
explicit caller-supplied project-root override" — closing the gap for a cwd
that sits *above* multiple nested project roots — as a real, deliberately
deferred follow-on, "a larger surface change... [deserving] its own design
pass rather than folding it into this ADR's scope."

Issue #227 reports a different bug in the same subsystem, discovered while
auditing `github-sdlc-plugins`' hook execution: a nearer ancestor directory's
`.config/gdlc/config.yml` can silently shadow a *further* ancestor's real
config, even when cwd unambiguously identifies one project (no sibling-repo
ambiguity — the exact case ADR-0005's deferred option was scoped to solve).
The concrete repro: `repos/gdlc/.config/gdlc/config.yml` defines only a
`board:` section; the workspace root above it defines a real `packs:` section
(`skipMutationConfirm: true`, the escape hatch #183 shipped for
`confirm-mutation.mjs`'s otherwise-unconditional `ask`). `findGdlcProjectRoot`
(and its TypeScript counterpart `findProjectConfigRoot`) stops climbing at the
**first** ancestor with *any* `.config/gdlc/config.yml`, regardless of
whether that file defines the section actually being resolved. Finding
`repos/gdlc`'s `board:`-only file, the `packs:` reader concludes "no
project-layer `packs:` section" and falls straight through to the *global*
layer, silently skipping the workspace-root ancestor's real override in
between.

This is not the ADR-0005-deferred case: no sibling-repo ambiguity exists
here, cwd correctly and unambiguously identifies `repos/gdlc` as the project.
The shadowing is between two *ancestor* config files, not a cwd-identifies-
which-project problem.

### Current Limitations

A first fix attempt (not merged) added a climb-past-a-non-matching-ancestor
predicate — `hasSection(text)`, testing only whether a candidate file's raw
text matched a `^sectionName:\s*$` header regex — independently to the three
`.mjs` hook copies, while a parallel attempt on the TypeScript side
(`config.ts`) took a different shape (collect every ancestor via existence
check, then merge each file's real, fully-parsed `GdlcConfig` object
furthest-to-nearest onto the global layer). An 8-angle local code review
found these two independently-written implementations disagreed for a
realistic trigger: a **nearer ancestor whose section header is present but
resolves to zero valid parsed content** (a comment-only body, or a body where
every key is malformed) — e.g. `prLifecycle`'s own already-existing
"present" check requires at least one successfully-parsed key (a fix for an
earlier, narrower bug, documented in `pr-lifecycle-config.mjs`'s own
`resolveLayerPrLifecycle` comment), which the header-regex predicate cannot
express. Confirmed empirically for all three sections (`board`, `packs`,
`prLifecycle`): the `.mjs` hooks stopped at the nearer, effectively-empty
ancestor and fell through to global, while `config.ts` correctly skipped it
and found the further ancestor's real value — a hook and an MCP tool
returning opposite answers for the identical file layout. That attempt was
reverted, unmerged.

## Decision Drivers

### Primary Decision Drivers

1. **The presence check for "does this ancestor define section X" MUST be
   the same function that actually parses and validates that section for
   real use** — never a second, independently-maintained predicate. Two
   sources of truth for the same question is exactly what produced the
   reverted attempt's divergence bug.
2. **All 4 independent implementations (`config.ts` and three `.mjs` hook
   copies) MUST resolve an identical directory/file layout to an identical
   value**, since a hook and an MCP tool can observe the same session's same
   config tree in the same turn (e.g. `confirm-mutation.mjs`'s PreToolUse
   gate and `create_issue`'s board-default resolution).
3. **Fix the actual reported bug (ancestor shadowing) without conflating it
   with ADR-0005's separately-deferred, different bug (cwd sibling-repo
   ambiguity).** A caller-supplied project-root override would touch every
   config-consuming tool's signature and doesn't address ancestor shadowing
   at all — cwd is already unambiguous in the reported repro.

### Secondary Decision Drivers

1. **No new runtime dependency**; the `.mjs` hook copies stay
   dependency-free per their own documented constraint (ADR-0005 Negative
   Consequence 2 already accepts this duplication as the cost of that
   constraint).
2. **No behavior change for the common case** (a single project layer with
   no shadowing ancestor) — the fast path must still resolve on the first
   real match, not degrade into scanning every ancestor even when the
   nearest one already has the answer.

## Considered Options

### Option 1: Keep single-nearest-match (status quo)

**Description**: No change — `findGdlcProjectRoot`/`findProjectConfigRoot`
keep stopping at the first ancestor with *any* config file, regardless of
whether it defines the section being resolved.

**Advantages**: Zero implementation risk; already shipped and stable for the
common case.

**Disadvantages**: This is the bug #227 reports. Already demonstrated to
silently drop a real ancestor override — including #183's `skipMutationConfirm`
escape hatch, for exactly the population most likely to need it (sessions
working inside `repos/gdlc` itself).

**Disqualifying Factor**: leaves the reported bug unfixed by definition.

**Risk Assessment**:

- **Technical Risk**: None (no change).
- **Schedule Risk**: None.
- **Ecosystem Risk**: High — the bug stays live, silently defeating config
  overrides for an unbounded set of future consumers with no diagnostic.

### Option 2: N-ancestor climb with a synthetic header-regex presence predicate

**Description**: Climb every ancestor with a config file, but decide "does
this ancestor define section X" via a standalone predicate — e.g.
`/^sectionName:\s*$/m.test(fileText)` — separate from the section's own real
parser.

**Advantages**: Simple to reason about in isolation; the predicate is a
small, independently testable function.

**Disadvantages**: A header-regex match is a *weaker* condition than "this
section has real, valid content" — `prLifecycle`'s own real presence check
(≥1 successfully-parsed key) is strictly stricter, so the predicate and the
real parser can disagree. Confirmed empirically (see Current Limitations):
this produces a NEW divergence bug between the `.mjs` hooks and `config.ts`
for all three sections, worse than the original bug because it is silent and
undetectable without an adversarial multi-angle review — the two
implementations return opposite answers for the same file, with no error, no
diagnostic, and passing test suite (until a regression test specifically for
this trigger is added).

**Disqualifying Factor**: introduces a second source of truth for "is this
section present," which drivers 1 rules out. Already built and reverted once
for this exact reason.

**Risk Assessment**:

- **Technical Risk**: Medium-High. Correctness depends on keeping a
  synthetic predicate behaviorally identical to each section's real parser,
  by hand, forever, across 4 files — already shown to drift once.
- **Schedule Risk**: Low to implement, but the divergence it introduces is
  the kind of bug that surfaces late, in production, not at review time
  without exactly this review's specific adversarial angle.
- **Ecosystem Risk**: High. A hook and an MCP tool silently disagreeing about
  the same file is a worse failure mode than the bug being fixed.

### Option 3 (chosen): N-ancestor climb using each section's own real parser as the presence oracle

**Description**: Separate directory *discovery* (existence-only, cheap) from
section *presence* (real parse+validate, already implemented and correct per
section). `findAllProjectConfigPaths`/`findAllGdlcProjectConfigPaths` collects
every ancestor directory with a `.config/gdlc/config.yml`, nearest-first, up
to `$HOME` (exclusive), skipping — not stopping at — a candidate whose
resolved path collides with the global layer's own path. Each section's
reader (`readBoardConfig`, `readPacksConfig`, `readPrLifecycleRaw`,
`loadGdlcConfig`) then iterates that list nearest-to-farthest, calling its
OWN existing real per-layer resolver (`resolveGdlcLayerBoard`,
`resolveLayerPacks`, `resolveLayerPrLifecycle`, `loadConfigFile`+
`normalizeConfig`) on each candidate and taking the first one where that
resolver's own "present" result is true — falling through to the global
layer's own resolver only if no ancestor's real presence check succeeds.
There is exactly one function per section that ever decides "is this present
here," used both for discovery and for final value extraction — no
possibility of two implementations disagreeing, because there is only one.

**Technical Characteristics**:

- `config.ts`: `findAllProjectConfigPaths` (existence-only walk, sharing its
  directory-walk loop with the pre-existing `findProjectConfigRoot` via a
  small internal generator, since both now need to stay in sync and there is
  no dependency-free reason for two copies in a real TypeScript module).
  `loadGdlcConfig` folds every found layer (furthest-to-nearest) onto the
  global layer via `Array.prototype.reduceRight` with the existing
  `mergeConfigs`, so a nearer ancestor's per-section values win over both
  global and every further ancestor. This algorithm already existed
  correctly in the reverted attempt — review found zero defects in it,
  confirmed no redundant re-reads and no O(N²) behavior — and is re-derived
  here, not novel.
- Each `.mjs` hook copy: an equivalent `findAllGdlcProjectConfigPaths`
  (dependency-free, no shared import across plugin boundaries, per each
  file's own documented convention), consumed by that file's own section
  reader in a simple loop-until-present, falling through to global.

**Advantages**: Satisfies all three primary drivers — single source of truth
per section (driver 1), byte-for-byte-equivalent behavior across all 4
implementations because they share the identical two-phase shape even though
the discovery/presence functions themselves are necessarily duplicated per
dependency-free-hooks constraint (driver 2), and fixes exactly the reported
ancestor-shadowing bug without touching any config-consuming tool's call
signature (driver 3, and explicitly does not attempt to solve ADR-0005's
separately-deferred sibling-repo-ambiguity case). The common case (no
shadowing) still resolves on the first candidate checked — no behavior
change, no added latency, for every session that isn't hitting this bug
(secondary driver 2).

**Disadvantages**: The existence-only discovery pass and the presence-check
pass are two separate directory reads in the shadowing case specifically
(discovery reads the directory listing/`existsSync` for every ancestor up
front; presence-checking then re-reads file *content* only for the
candidates actually visited before finding a match) — strictly more work
than the old single-candidate check only when an override actually needs to
be found past a nearer non-matching ancestor, which is the case this ADR
exists to fix correctly, not a regression against a working baseline.

**Risk Assessment**:

- **Technical Risk**: Low. Each section's presence oracle is code that
  already exists, is already tested, and already the single call site for
  "resolve this section's real value" — this option only changes how many
  ancestor directories get a turn to answer that same existing question, not
  what the question itself returns.
- **Schedule Risk**: Low. No new external dependency, no changed public tool
  signatures.
- **Ecosystem Risk**: Low. Additive to the existing per-section cascade
  semantics ADR-0004 established; extends ADR-0005's upward search to
  multiple ancestors without reopening its cwd-ambiguity scope.

### Option 4: Explicit caller-supplied project-root override

**Description**: The option ADR-0005 named and deferred — every
config-consuming tool call accepts an explicit `projectRoot` argument,
supplied by the caller, instead of any implicit directory search.

**Advantages**: Would fully close ADR-0005's own deferred sibling-repo-ambiguity
gap, since only the caller invoking a specific `owner`/`repo`-scoped tool
call actually knows which repo it concerns.

**Disadvantages**: Touches every config-consuming tool's call signature
across all plugins — a much larger, more disruptive surface change than
Option 3. Does **not** solve the bug this ADR is actually about: #227's
repro has cwd unambiguously identifying one project already (`repos/gdlc`),
with no sibling-repo ambiguity for an explicit root to resolve — the
shadowing is between two *ancestor* config files, a different bug than the
one this option was scoped for.

**Disqualifying Factor**: solves a different problem than the one reported;
adopting it here would conflate two separately-scoped gaps and still leave
#227 unfixed. Remains a live option for ADR-0005's own still-open gap, out
of scope for this ADR.

**Risk Assessment**:

- **Technical Risk**: Medium. Signature changes ripple through every plugin
  that consumes config.
- **Schedule Risk**: High. Broad surface, many call sites, coordinated
  rollout across independent plugin packages.
- **Ecosystem Risk**: Medium. Breaking-ish change to tool call shapes for a
  gap this ADR doesn't need closed to fix #227.

## Decision

We adopt **Option 3**: N-ancestor climb, per-section, using each section's
own existing real parse+validate function as the sole presence oracle — no
synthetic predicate, implemented consistently (same two-phase discovery/
presence shape) across `config.ts`, `github-sdlc-planning`'s
`in-progress.mjs`/`settings.mjs`, `github-bug-capture`'s `settings.mjs`, and
`github-pull-requests`'s `pr-lifecycle-config.mjs`.

This amends and extends ADR-0004's per-section cascade (now resolved across N
ancestor layers instead of exactly one project layer) and ADR-0005's upward
search (now continuing past a non-matching ancestor instead of stopping at
the first file found) — a judgment call, documented here explicitly: neither
ADR-0004's core carrier/path decision nor ADR-0005's core upward-search
decision is reversed or invalidated, only generalized from "exactly one
project layer" to "every ancestor layer, per section." Their `status:`
fields remain `accepted`, not `superseded`; each gets a short cross-reference
note in its own Audit table pointing here, per this repo's existing
lightweight cross-reference convention (the same pattern ADR-0005's own
Audit table already uses to record findings from its own review round)
rather than a fresh supersession record.

Option 4 (the caller-supplied override ADR-0005 deferred) remains a live,
separately-scoped option for that ADR's own still-open sibling-repo-ambiguity
gap — this ADR does not close it and does not need to, since #227's bug is a
different one.

## Consequences

### Positive

1. `board:`/`packs:`/`prLifecycle:` overrides set at any ancestor directory
   are now found correctly, closing #227 and restoring #183's
   `skipMutationConfirm` escape hatch for sessions working inside a nested
   project repo.
2. A hook and an MCP tool observing the same config tree in the same session
   now provably return the same answer for every section, by construction —
   there is only one presence-check function per section, used by both.
3. The common (non-shadowing) case is unaffected — same first-match
   resolution, same latency, as before this ADR.

### Negative

1. The shadowing-repair case (an override past a nearer non-matching
   ancestor) does strictly more directory/file work than the old
   single-candidate check — proportional to how many ancestors exist between
   cwd and the real match, bounded by the existing `$HOME` ceiling.
2. Four independent implementations still exist (the dependency-free hooks
   constraint from ADR-0005 is unchanged) — a future correctness fix to the
   two-phase shape itself must still be applied in up to 4 places by hand,
   the same maintenance cost ADR-0005 already accepted for the single-ancestor
   version of this same duplication.

### Neutral

1. ADR-0005's own deferred caller-supplied-override gap (sibling-repo cwd
   ambiguity) remains open, unaddressed by this ADR, and is not conflated
   with the bug this ADR closes.

## Decision Outcome

The decision achieves its objective — no ancestor config override is
silently shadowed by a nearer, non-defining ancestor, with all 4
implementations agreeing on every input — measured by: `findAllProjectConfigPaths`/
`findAllGdlcProjectConfigPaths` exist in all 4 files and share the identical
two-phase discovery/presence shape; each section's reader uses its own
existing real parser as the sole presence oracle, with no separate predicate
anywhere; regression tests cover both "no header at all" and "header present,
zero valid content" for all three sections, in both the `.mjs` hook test
suites and `config.test.ts`; and ADR-0004/0005's own Audit tables carry a
cross-reference note to this ADR without a `status:` change.

Mitigations:

- The shadowing-repair case's extra directory work is bounded by the
  existing `$HOME` ceiling from ADR-0005 — never unbounded.
- The 4-implementation duplication cost is the same one ADR-0005 already
  named and accepted as the price of the dependency-free hooks constraint;
  this ADR does not add a new instance of that tradeoff, only extends the
  existing one from 1 ancestor to N.

## Related Decisions

- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004] —
  established the two-layer carrier and per-section-wholesale-replacement
  cascade this ADR generalizes from exactly one project layer to N ancestor
  layers.
- [ADR-0005: Upward Directory Search for Project Config, Plus a Resolution
  Diagnostic][adr-0005] — established upward search stopping at the first
  matching ancestor and named the caller-supplied-override option (Option 4
  above) as separately-scoped follow-on work this ADR does not close.

## Links

- Issue [#227](https://github.com/modeled-information-format/gdlc/issues/227) —
  this ADR's tracking Epic, including the full 8-angle review findings on the
  reverted first attempt.
- [`docs/decisions/adr-0004-project-config-surface.md`](adr-0004-project-config-surface.md) —
  the carrier and cascade decision this ADR extends.
- [`docs/decisions/adr-0005-project-config-cwd-resolution.md`](adr-0005-project-config-cwd-resolution.md) —
  the upward-search decision this ADR extends, and the source of the
  separately-scoped Option 4.

## More Information

- **Date:** 2026-07-11
- **Source:** Issue #227.
- **Related ADRs:** ADR-0004, ADR-0005.

## Audit

### 2026-07-11

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| ------- | ----- | ----- | ---------- |
| Decision and implementation land together across `config.ts` and all three `.mjs` hook copies, plus regression tests for both the absent-header and present-but-empty triggers | `mcp-server/src/config.ts`, `hooks/lib/in-progress.mjs`, `hooks/lib/settings.mjs` (github-sdlc-planning and github-bug-capture), `hooks/lib/pr-lifecycle-config.mjs` | - | compliant |

**Summary:** Decision and implementation land together; no open objections.
A first attempt at this same decision (Option 2 above) was built, reviewed,
and reverted before this ADR was written — the review findings that ruled
out Option 2 are recorded in this ADR's Context and Considered Options
sections directly, not just cross-referenced.

**Action Required:** None.

[adr-0004]: adr-0004-project-config-surface.md
[adr-0005]: adr-0005-project-config-cwd-resolution.md
