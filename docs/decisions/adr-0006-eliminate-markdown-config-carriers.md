---
title: "Eliminate the Remaining Markdown Config Carriers"
description: "Supersedes ADR-0004's local-only call for github-bug-capture's pack toggles: they move into a packs: section of .config/gdlc/config.yml, becoming committed team policy. Also closes ADR-0004's one-release window for the legacy board: key in .claude/github-sdlc-planning.local.md."
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
  - plugin-composition
status: accepted
created: 2026-07-09
updated: 2026-07-09
author: MIF Maintainers
project: gdlc
technologies:
  - yaml
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

# ADR-0006: Eliminate the Remaining Markdown Config Carriers

## Status

Accepted

## Context

### Background and Problem Statement

Epic #139 asks for a single config surface across the plugin suite: after
this ADR, no `.claude/<plugin>.local.md` config carrier remains anywhere,
and `.config/gdlc/config.yml` (project + global layers, ADR-0004/0005) is
the only place a contributor or an agent looks for gdlc plugin config.

Two markdown carriers are still live:

1. **`github-bug-capture`'s pack toggles** (`.claude/github-bug-capture.local.md`,
   a `packs:` map of `hooks`/`triage-skills`/`mcp-integration`/`gh-aw`
   booleans). ADR-0004 explicitly and deliberately kept this local-only —
   its own title is "`.claude/<plugin>.local.md` Stays Local-Only" — reasoning
   that a personal, per-developer runtime preference should not share a
   carrier with team-shared, committed policy.
2. **`github-sdlc-planning`'s legacy `board:` key**
   (`.claude/github-sdlc-planning.local.md`), which ADR-0004 already
   superseded with `.config/gdlc/config.yml`'s `board:` section, kept
   working "for one release" as a deprecation-notice fallback
   (`hooks/lib/in-progress.mjs`'s `readLegacyBoardConfig`).

This ADR revisits point 1 and closes out point 2.

### What changed since ADR-0004

ADR-0004's reasoning for keeping pack toggles local-only was sound on its
own terms: a personal opt-in and committed team policy are genuinely
different in kind, and conflating their carriers was a real risk. That
reasoning is not being disputed here. What changed is the requirement this
ADR is scored against: eliminate every markdown-based config carrier in the
suite, full stop, even where the original design for keeping one had a
legitimate rationale. This ADR makes that trade-off explicit rather than
treating the carrier elimination as a bug fix — it is a deliberate policy
change, accepted with its cost named.

### Constraints

- Whatever carrier packs move to must already exist and be already parsed
  by both an MCP-server consumer (if any) and a dependency-free hook-layer
  reader — introducing a third file format or a third resolution mechanism
  defeats the stated goal of "one config surface."
- `github-bug-capture`'s `hooks/lib/settings.mjs` cannot depend on
  `node_modules` at hook-execution time (documented constraint, matches
  `github-sdlc-planning/hooks/lib/in-progress.mjs`); any new reader must stay
  dependency-free, same as the existing `board:` section reader
  (`parseGdlcBoardSection`) it will mirror.
- The legacy `board:` fallback's removal was already decided by ADR-0004;
  this ADR only needs to confirm the one-release window is over and record
  that decision's execution, not re-litigate the carrier choice.

## Decision Drivers

### Primary Decision Drivers

1. **One config surface, no exceptions.** Epic #139's explicit requirement:
   after this Epic, `.config/gdlc/config.yml` is the only config file any
   plugin reads, for any purpose.
2. **Reuse the existing per-section cascade, not a new mechanism.**
   `targeting`/`destination`/`board` already have a working project-overrides-
   global cascade (ADR-0004's `mergeConfigs`); a `packs:` section should be a
   fourth section in the same file, not a new resolution scheme.
3. **Name the trade-off, don't hide it.** Moving pack toggles into the
   committed project layer changes their nature from personal/uncommitted to
   team-shared/committed. This ADR records that change explicitly so a future
   reader does not mistake it for an oversight.

### Secondary Decision Drivers

1. **Minimize new dependency-free hook code.** `in-progress.mjs`'s
   `parseGdlcBoardSection`/`readBoardConfig` pattern is proven; the new
   `packs:` reader in `github-bug-capture`'s `settings.mjs` should mirror it
   structurally rather than invent a different parsing approach.
2. **Bounded migration cost.** Removing the legacy `board:` fallback and the
   pack-toggle markdown carrier in the same Epic, rather than staggering
   them across releases, keeps the "no markdown remains" state easy to
   verify (a single `grep -rn "\.local\.md"` sweep).

## Considered Options

### Option 1: `packs:` section in the project-layer `.config/gdlc/config.yml`

**Description**: Add a `packs:` top-level section to the same file
`targeting`/`destination`/`board` already live in. Project layer only for
now (packs are inherently per-repo); the existing global-layer fallback
applies for free once a caller reads it the same way `board:` does.

**Technical Characteristics**: One new top-level YAML section, validated by
the same `normalizeConfig`/`parseGdlcBoardSection`-style pattern already
proven for `board:`. No new file, no new resolution mechanism.

**Advantages**:

- Reuses the exact cascade, path resolution, and upward-search machinery
  already built and tested for `targeting`/`destination`/`board`.
- Keeps "one config surface" literally true — a contributor editing project
  config edits exactly one file for any of the four concerns.
- The hooks-layer reader in `github-bug-capture` mirrors an already-proven
  pattern (`in-progress.mjs`'s board-section reader) instead of inventing one.

**Disadvantages**:

- Pack toggles become committed, team-shared policy. A developer who wants
  `hooks` enabled only for their own local sessions no longer has a purely
  personal, uncommitted way to do that — the whole team (and every agent
  session reading the committed file) sees the same toggle state.
- Loses ADR-0004's original per-developer/per-session distinction entirely;
  this is the accepted cost of this decision, not a hidden one.

**Risk Assessment**:

- **Technical Risk**: Low. Directly extends proven code.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low-Medium. Any existing installation relying on a
  personal `.claude/github-bug-capture.local.md` toggle needs to migrate its
  settings into the committed project file — a real, if small, migration
  cost for existing adopters (this repo included).

### Option 2: `packs:` section in the global-layer `$XDG_CONFIG_HOME/gdlc/config.yml`

**Description**: Move pack toggles to the per-user, per-machine global
layer instead of the project layer, preserving "personal" (it's not
committed to any repo) while still eliminating the markdown carrier.

**Technical Characteristics**: Same section shape as Option 1, read only
from the global layer.

**Advantages**:

- Preserves the "personal, not committed" property ADR-0004 valued — the
  global layer is a machine-local file, never checked into a repo.

**Disadvantages**:

- Loses per-repo granularity, which the pack-toggle system explicitly has
  today (a developer working across `gdlc`, `backstage-idp`, and other
  consuming repos may reasonably want different pack toggles per repo — the
  global layer cannot express that).
- Regresses a real, already-used capability (per-repo toggles) to eliminate
  a file format, trading a bigger capability loss for a smaller cosmetic
  one.

**Risk Assessment**:

- **Technical Risk**: Low.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium. Any consuming repo relying on per-repo pack
  differentiation loses that capability outright, not just its carrier.

**Disqualifying Factor**: trades a real capability (per-repo granularity)
for no gain beyond file format, when Option 1 achieves the stated goal
without that loss (at the cost of committed-vs-personal, which the decision
explicitly accepts instead).

### Option 3: A new uncommitted per-repo YAML file (`.config/gdlc/config.local.yml`)

**Description**: Introduce a third file — still YAML, still per-repo, but
gitignored/`.git/info/exclude`-excluded — layered on top of the committed
project file, preserving both "personal" and "per-repo" while eliminating
markdown as the format.

**Technical Characteristics**: A third resolution layer between project and
global, YAML-shaped, uncommitted by convention.

**Advantages**:

- Would have preserved every property of the original design (personal,
  per-repo, uncommitted) while still satisfying "no markdown."

**Disadvantages**:

- Directly contradicts this Epic's primary decision driver: "one config
  surface, no exceptions." A third file is a third surface, even if it
  happens to be YAML-shaped like the other two.
- Adds a third resolution tier to every reader (`config.ts` and each
  hooks-layer reader), each of which already carries real complexity from
  two tiers plus the upward-search behavior (ADR-0005). A third tier
  compounds that complexity for a property (packs-stay-personal) this
  Epic's confirmed decision does not require preserving.

**Risk Assessment**:

- **Technical Risk**: Medium. New resolution tier in every consumer.
- **Schedule Risk**: Medium.
- **Ecosystem Risk**: Low.

**Disqualifying Factor**: solves a problem (preserve personal/uncommitted
packs) that this Epic's explicit, confirmed decision does not ask to be
solved, at the cost of a new resolution tier in every config consumer.

## Decision

We adopt **Option 1**: pack toggles move into a `packs:` section of the
project-layer `.config/gdlc/config.yml`, and the legacy `board:` key
fallback in `.claude/github-sdlc-planning.local.md` is removed outright.

- `schema/gdlc-config.schema.json` gains a `packs` section (object of
  pack-name → boolean).
- `github-sdlc-planning`'s `config.ts` gains `packs?: Record<string,
  boolean>` on `GdlcConfig`, normalized the same fail-soft way as the other
  sections.
- `github-bug-capture`'s `hooks/lib/settings.mjs` drops its markdown-frontmatter
  parser entirely and reads the `packs:` section of `.config/gdlc/config.yml`
  (project layer; global layer as a fallback for any pack not set at the
  project layer), via a dependency-free reader mirroring
  `in-progress.mjs`'s `parseGdlcBoardSection`.
- `github-sdlc-planning`'s `hooks/lib/in-progress.mjs` drops
  `readLegacyBoardConfig`/`parseBoardConfig` and the third fallback tier in
  `readBoardConfig` — only the two `.config/gdlc/config.yml` layers remain.
- `KNOWN_PACKS` (`hooks`, `triage-skills`, `mcp-integration`, `gh-aw`) stays
  the validation source of truth; the schema's `packs` section is not
  hardcoded to exactly these four so a future pack can be added without a
  schema change.

## Consequences

### Positive

1. **One config surface, verifiably.** `grep -rn "\.local\.md"` across the
   whole plugin suite returns only historical references after this Epic
   lands — a mechanically checkable definition of "done."
2. **No new resolution mechanism.** The `packs:` reader in both the
   MCP-server loader and the hooks-layer reader reuses the exact cascade and
   parsing pattern already proven for `board:`.
3. **ADR-0004's original reasoning is preserved as a documented rationale**,
   even though its conclusion for pack toggles is reversed here — a future
   reader sees both the original "why personal" argument and this ADR's
   "why we changed it anyway" argument side by side.

### Negative

1. **Pack toggles become committed, team-shared policy.** A contributor can
   no longer set `hooks: true` for their own sessions without every other
   contributor and every agent session in that repo seeing the same value.
   This is the accepted cost of this decision.
2. **Migration cost for any existing `.claude/github-bug-capture.local.md`
   file.** Anyone with pack toggles already set that way needs to move them
   into `.config/gdlc/config.yml`'s new `packs:` section by hand; there is no
   automated one-release fallback for this carrier (unlike the `board:`
   key's prior migration), since Epic #139's acceptance criteria call for
   the markdown carrier's removal to be complete now, not staged.

### Neutral

1. **The legacy `board:` fallback's removal was already decided by
   ADR-0004** — this ADR's role there is confirming the window is closed and
   recording the removal, not making a new call.

## Decision Outcome

The decision achieves its objective — zero markdown-based config carriers
in the plugin suite — measured by: `schema/gdlc-config.schema.json` and
`config.ts` both define a `packs` section; `github-bug-capture`'s
`hooks/lib/settings.mjs` contains no `.claude/*.local.md` reference;
`github-sdlc-planning`'s `hooks/lib/in-progress.mjs` contains no legacy
`board:` fallback; and a repo-wide `grep -rn "\.local\.md"` across
`plugins/` and `docs/` returns only historical references.

## Related Decisions

- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004] —
  superseded by this ADR specifically for the pack-toggle carrier decision;
  its project/global-layer path design and `targeting`/`destination`/`board`
  schema are unaffected and remain in force.
- [ADR-0005: Upward Directory Search for Project Config][adr-0005] — the
  upward-search resolution this ADR's `packs:` reader reuses unchanged.

## Links

- Epic [#139](https://github.com/modeled-information-format/gdlc/issues/139) —
  this ADR's tracking epic.
- Issue [#140](https://github.com/modeled-information-format/gdlc/issues/140) —
  this ADR's own authoring Story.
- Issue [#141](https://github.com/modeled-information-format/gdlc/issues/141) —
  schema/config.ts implementation of the `packs:` section.
- Issue [#142](https://github.com/modeled-information-format/gdlc/issues/142) —
  `github-bug-capture` pack-toggle reader migration.
- Issue [#143](https://github.com/modeled-information-format/gdlc/issues/143) —
  legacy `board:` fallback removal.
- Issue [#144](https://github.com/modeled-information-format/gdlc/issues/144) —
  documentation updates.

## More Information

- **Date:** 2026-07-09
- **Source:** Epic #139.
- **Related ADRs:** ADR-0004, ADR-0005.

## Audit

### 2026-07-09

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Decision confirmed explicitly by the repository owner, trade-off (committed vs. personal pack toggles) named and accepted before implementation began | - | - | compliant |

**Summary:** Drafted and accepted in the same session the implementing
Stories (#141–#144) were filed and executed; no open objections to Option 1,
the `packs:` schema location, or the legacy `board:` fallback's removal.

**Action Required:** None for this ADR. Issues #141–#144 implement against
this chosen design.

[adr-0004]: adr-0004-project-config-surface.md
[adr-0005]: adr-0005-project-config-cwd-resolution.md
