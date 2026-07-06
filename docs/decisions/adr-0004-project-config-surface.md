---
title: "One XDG-Mirrored Path for Global and Project Config; .claude/<plugin>.local.md Stays Local-Only"
description: "Project-level targeting/board-mapping config lives in .config/gdlc/config.yml (pure YAML), mirroring the global layer's $XDG_CONFIG_HOME/gdlc/config.yml path; .claude/<plugin>.local.md keeps only personal, uncommitted runtime toggles, and its shipped board key migrates into the new file."
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
created: 2026-07-05
updated: 2026-07-06
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
  - adr-0003-board-status-hygiene.md
---

# ADR-0004: One XDG-Mirrored Path for Global and Project Config; .claude/<plugin>.local.md Stays Local-Only

## Status

Accepted

## Context

### Background and Problem Statement

Epic #78 asks for a layered configuration system — global plus project level —
governing which repos/orgs gdlc's plugins capture issues for, where captured
issues get posted, org/user preference overrides, and per-project board/repo
mappings. This ADR is scoped to issue #79 only: choosing the **project-level**
configuration surface. The global layer's XDG-conformant location is issue
#80's design; the full key/value schema for either layer is issue #81's
design. This ADR fixes format, path, and reconciliation with what already
ships — not the schema.

A project-level surface already exists today, informally: `github-sdlc-planning`
ships a documented `board:` key inside `.claude/github-sdlc-planning.local.md`
(`docs/how-to/plan-work-with-the-plugins.md`, step 3):

```markdown
---
board:
  projectOwnerLogin: <org-or-user>
  projectNumber: <n>
---
```

`github-bug-capture` uses the same file-naming convention
(`.claude/github-bug-capture.local.md`) for an unrelated purpose — per-pack
opt-in booleans (`docs/pack-toggles.md`): `hooks`, `triage-skills`,
`mcp-integration`, `gh-aw`, default-off, fail-closed, read at use time. Both
files are explicitly **uncommitted** ("keep out of version control via that
project's `.gitignore` or `.git/info/exclude`") and both are **YAML
frontmatter inside a markdown file**.

That is the reconciliation problem: `board:` is genuinely different in kind
from the pack toggles. A pack toggle is a personal, ephemeral runtime
preference — which enhancement packs *this developer's* Claude Code session
has turned on. `projectOwnerLogin`/`projectNumber` is team-shared,
committable policy — which Projects v2 board *this repository's* issues
belong on, true for every contributor and every agent session alike. The two
have been sharing one carrier and one "don't commit this" convention only
because the carrier was built for the first purpose and the second reused it
without a design pass.

### Constraints from #78

- Every config file must be **structured text, JSON or YAML only**. No
  free-form markdown-with-frontmatter as the *sole* carrier, no custom DSL.
  Read literally, this already disqualifies extending the existing
  `.claude/<plugin>.local.md` frontmatter-in-markdown pattern to carry the new
  targeting/board config — the same problem the constraint calls out, not a
  path this ADR needs to re-litigate against a different file name.
- The industry precedent #78 cites for the global layer is the XDG Base
  Directory Specification (`$XDG_CONFIG_HOME`, default `~/.config/`), with `gh`
  and `git` both storing structured config under it. Design direction for this
  ADR: the project-level surface should not be an independent path scheme —
  it should mirror the same relative path the global layer resolves under
  `$XDG_CONFIG_HOME`, just rooted at the project instead of the user's home.
  One path-joining rule then serves both layers.

### Prior art considered and not chosen as-is

- **AGENTS.md-embedded block** — the planning-plugin research report
  recommends AGENTS.md (the AAIF-ratified agent-neutral standard) as the home
  for project-specific agent guidance (namespace, default project ID, label
  taxonomy, issue type mapping). Considered below as Option 1.
- **`harness.config.json` control plane** — the bug-capture research
  blueprint's original design: a JSON control plane materialized into
  Claude-Code-local settings by a sync script. What actually shipped instead,
  for the one thing this blueprint covered (pack toggles), was the simpler
  direct-read `.claude/github-bug-capture.local.md`. Considered below as
  Option 3.
- **GitHub-native org custom properties** (`/orgs/{org}/properties/schema`) —
  named and explicitly deferred as orthogonal by the planning-plugin research;
  not re-opened here since #78 doesn't ask for it and it doesn't produce a
  project-committed file at all (it's an org-side API resource, not something
  a repo's contributors read/diff/PR).

## Decision Drivers

### Primary Decision Drivers

1. **Structured-text-only, literally.** The chosen carrier's entire file
   content must be the config — not a block extracted from a document whose
   primary purpose and edit pattern is free prose, and not YAML frontmatter
   wrapping a markdown body.
2. **One relative-path convention for both layers.** The project-level and
   global-level (#80) surfaces must resolve via the same path-joining rule —
   `<root>/gdlc/config.yml` — so a single loader function (#82) differs only
   in which root it's given (`$XDG_CONFIG_HOME` for global, the project root
   for project-level), rather than two independent path schemes that
   coincidentally both call themselves "XDG-ish."
3. **Personal-preference scope must stay separate from team-shared policy.**
   Config that decides which repos/orgs are targeted and which board issues
   land on is committed team policy, true for every contributor; it must not
   share a carrier — or a "don't commit this" convention — with a developer's
   personal, uncommitted runtime toggles.

### Secondary Decision Drivers

1. **Reuse of proven parsing.** This marketplace already vendors YAML parsing
   (`js-yaml`/`yaml`) for MIF frontmatter across every plugin; a plain-YAML
   project file adds no new parsing dependency.
2. **Minimal, documented migration cost.** The one config key that already
   shipped in the wrong place (`board:`) should have a stated, bounded
   migration path, not a silent break for the one how-to guide that documents
   it today.

## Considered Options

### Option 1: AGENTS.md-embedded structured block

**Description**: Add a fenced `yaml`/`json` block (or a dedicated
`## gdlc-config` section) inside the project's `AGENTS.md` that the
config-loader parses out by convention.

**Technical Characteristics**:

- No new file; the config-loader scans `AGENTS.md` for a recognized fence or
  heading and parses only that span.

**Advantages**:

- Reuses a file many AI-agent-facing projects already have; one less file for
  maintainers to discover.
- Already recommended by the planning-plugin's own research report for
  adjacent settings (namespace, default project ID, label taxonomy).

**Disadvantages**:

- AGENTS.md's near-universal use across the ecosystem is free-form prose
  guidance to coding agents; extracting one fenced block by convention from an
  otherwise unstructured document reproduces the exact
  frontmatter-in-markdown pattern the structured-text constraint rules out —
  just moved from YAML frontmatter to a body fence, not eliminated.
- Every other tool or human that edits `AGENTS.md` as prose (documentation
  generators, other agents, a human doing an unrelated edit) can silently
  shift, duplicate, or break the one recognized fence, with no schema
  enforcement at that layer protecting it.
- Does not share a relative-path convention with the global layer (#80) —
  `AGENTS.md` lives at a fixed repo-root filename, not a directory a
  `$XDG_CONFIG_HOME`-style root can also produce. Two independent resolution
  rules would be needed, not one.

**Risk Assessment**:

- **Technical Risk**: Medium. Parsing must tolerate arbitrary surrounding
  prose and possible multiple fenced blocks.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium. Couples gdlc's machine-config lifecycle to a
  document whose primary audience and edit pattern is human/prose.

**Disqualifying Factor**: violates the structured-text-only constraint in
substance (the config is not the sole content of its carrier) and shares no
path convention with the global layer.

### Option 2: `.config/gdlc/config.yml` — project-relative mirror of the global XDG path

**Description**: A standalone, committed, pure-YAML file at
`.config/gdlc/config.yml`, relative to the project root — the same
`gdlc/config.yml` relative path the global layer (#80) resolves under
`$XDG_CONFIG_HOME`. One shared plugins-wide file (not per-plugin); owns
repo/org allowlist, destination targeting, and project-board mapping. Its
full key schema is issue #81's design, not this ADR's.

**Technical Characteristics**:

- Entire file content is the config; no prose, no frontmatter wrapper.
- The config-loader module (#82) resolves both layers with one function:
  `resolve(root) => join(root, "gdlc", "config.yml")`, called once with
  `process.env.XDG_CONFIG_HOME ?? join(home, ".config")` and once with the
  project root, then merges (project overriding global — merge precedence is
  #82's job to finalize, noted here as the expected direction).

**Advantages**:

- Satisfies the structured-text constraint outright: the whole file is
  config, nothing to extract from surrounding prose.
- Directly satisfies the path-unification driver: identical relative
  suffix (`gdlc/config.yml`) under two different roots, one loader function.
- Matches the industry precedent #78 already cites (`gh`'s own
  `$XDG_CONFIG_HOME/gh/config.yml`, `git`'s `$XDG_CONFIG_HOME/git/config`) —
  and this org's own dependency chain, since every plugin here already shells
  out to `gh`.
- Trivially diffable/reviewable in a PR: the sole content of the file is the
  setting being changed.
- Groups gdlc-specific config under one discoverable subdirectory instead of
  adding another bare dotfile at project root alongside every other tool's.

**Disadvantages**:

- One more path segment (`.config/gdlc/`) than a flat root dotfile; a
  first-time contributor scanning repo root for config won't see it without
  knowing the convention (mitigated by documentation, #84).
- Overlaps the already-shipped `board:` key in
  `.claude/github-sdlc-planning.local.md` until #82/#83 land the migration.

**Risk Assessment**:

- **Technical Risk**: Low. Plain YAML, existing parser, one new resolution
  function shared by both layers.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low. Additive; does not touch `AGENTS.md` or any
  existing consumer of `.claude/<plugin>.local.md`.

### Option 3: `harness.config.json` control plane materialized into `.claude/settings.local.md` by a sync script

**Description**: Reproduce the bug-capture blueprint's original design for
the broader targeting/board problem — a JSON control-plane file, synced into
Claude-Code-local settings by a script step.

**Technical Characteristics**:

- New `harness.config.json` at project root plus a sync script that
  materializes selected keys into `.claude/*.local.md` frontmatter at some
  trigger point (install, pre-commit, or manual).

**Advantages**:

- Blueprint fidelity; JSON control-plane is a familiar shape from the
  original bug-capture research.

**Disadvantages**:

- This exact design was already tried once, for the narrower pack-toggle
  problem, and deliberately replaced before shipping by the simpler
  direct-read `.claude/github-bug-capture.local.md` frontmatter convention
  (`docs/pack-toggles.md`). Repeating the sync-script indirection for the
  larger targeting/board problem reintroduces the complexity already rejected
  for the smaller one, without a matching increase in capability.
- The sync script is new code with its own staleness-detection burden —
  structurally the same class of problem this repo already has to guard
  against elsewhere (`quality-gates.yml`'s `dist/` freshness check exists
  because a generated artifact can silently drift from its source).
- Shares no path convention with the global layer unless redesigned to do so,
  at which point it collapses into Option 2 with an unnecessary sync step
  added on top.

**Risk Assessment**:

- **Technical Risk**: Medium. New sync-script code, a new staleness class to
  detect and guard.
- **Schedule Risk**: Medium.
- **Ecosystem Risk**: Low.

**Disqualifying Factor**: reintroduces an indirection this marketplace
already tried and abandoned for a narrower version of the same problem, with
no capability gained in exchange.

## Decision

We adopt **`.config/gdlc/config.yml` (Option 2)**: a standalone, committed,
pure-YAML file at the project-relative mirror of the global layer's
`$XDG_CONFIG_HOME/gdlc/config.yml` path.

Reconciliation with the existing shipped surface:

- **`.claude/<plugin>.local.md` files are unchanged in purpose and remain
  uncommitted**: they carry only personal, per-developer, per-Claude-Code-session
  runtime toggles. `github-bug-capture.local.md`'s `packs:` map is the only
  correct current occupant of that carrier and does not move.
- **`github-sdlc-planning.local.md`'s `board:` key is superseded.** Team-shared,
  committed board targeting (`projectOwnerLogin`/`projectNumber`) moves into
  `.config/gdlc/config.yml` under a `board:` section (exact schema: #81). The
  loader (#82) reads the new file first; if absent, it falls back to the
  legacy `board:` key in `.claude/github-sdlc-planning.local.md` for one
  release with a deprecation notice, then the fallback is removed (#83's
  implementation, not this ADR's).
- **Full key schema for repo/org allowlist and destination targeting is out
  of scope here** — issue #81 designs it against this chosen carrier.
- **The global layer's exact resolution rule** (`XDG_CONFIG_HOME` default,
  Windows/macOS fallback behavior) is issue #80's design; this ADR commits
  only to the shared relative-path suffix (`gdlc/config.yml`) the two layers
  must agree on.

## Consequences

### Positive

1. **Constraint compliance without interpretation debate.** The entire file
   is config; there is no "does a block-in-a-prose-file count as structured
   text" question to relitigate later.
2. **One loader, one path rule, two roots.** The config-loader module (#82)
   implements a single `resolve(root)` function instead of two independent
   per-layer path schemes.
3. **Clean scope separation.** `.claude/<plugin>.local.md` narrows to its
   correct, original purpose — personal runtime toggles — with nothing
   team-shared sharing its "don't commit this" convention.

### Negative

1. **One more top-level directory** (`.config/gdlc/`) in every consuming
   project (mitigated: documented in #84; mirrors a directory shape XDG-aware
   contributors already recognize from `gh`/`git`).
2. **Migration debt on `board:`.** At least one currently-working
   installation (this repo's own `docs/how-to/plan-work-with-the-plugins.md`)
   documents the legacy key; the deprecation window and doc update are
   real follow-on work (#82, #83, #84), not free.

### Neutral

1. **Merge precedence between the two layers** (project overrides global, or
   the reverse) is asserted here as the expected direction but finalized by
   #82, not fixed as binding by this ADR.

## Decision Outcome

The decision achieves its objective — one project-level config surface that
is structured-text-only and path-unified with the global layer — measured
by: `.config/gdlc/config.yml` exists as a standalone YAML file with no
frontmatter or surrounding prose; zero GitHub-targeting or board-mapping keys
are embedded in `AGENTS.md`; the config-loader (#82) resolves both layers
through one shared `gdlc/config.yml` suffix; and the `board:` key's migration
path out of `.claude/github-sdlc-planning.local.md` is documented here and
implemented with a deprecation notice (#83).

Mitigations:

- Discoverability of the new directory is covered by #84's documentation
  pass.
- `board:` migration risk is covered by the one-release fallback window
  specified above, owned by #82/#83.

## Related Decisions

- [ADR-0003: Rely on Native Projects v2 Workflows for Status Hygiene][adr-0003] —
  the source of the `projectOwnerLogin`/`projectNumber` board-targeting need
  this ADR's `board:` migration addresses.

## Links

- Epic [#78](https://github.com/modeled-information-format/gdlc/issues/78) —
  the layered configuration system this ADR's issue is a child of.
- Issue [#79](https://github.com/modeled-information-format/gdlc/issues/79) —
  this ADR's tracking issue.
- Issue [#80](https://github.com/modeled-information-format/gdlc/issues/80) —
  global config schema and XDG-conformant resolution (depends on this ADR's
  shared path suffix).
- Issue [#81](https://github.com/modeled-information-format/gdlc/issues/81) —
  project-level config schema (depends on this ADR's chosen carrier).
- Issue [#82](https://github.com/modeled-information-format/gdlc/issues/82) —
  shared config-loader module (implements the `resolve(root)` rule and the
  `board:` migration fallback).
- [`docs/how-to/plan-work-with-the-plugins.md`](../how-to/plan-work-with-the-plugins.md) —
  documents the legacy `board:` key this ADR migrates.
- [`plugins/github-bug-capture/docs/pack-toggles.md`](../../plugins/github-bug-capture/docs/pack-toggles.md) —
  documents the `.claude/<plugin>.local.md` convention this ADR narrows in
  scope but does not change.

## More Information

- **Date:** 2026-07-05
- **Source:** Epic #78; issue #79.
- **Related ADRs:** ADR-0003.

## Audit

### 2026-07-05

**Status:** Pending

**Findings:**

| Finding                                                     | Files | Lines | Assessment |
| ------------------------------------------------------------ | ----- | ----- | ---------- |
| Drafted as proposed; awaiting maintainer review               | -     | -     | pending    |

**Summary:** Drafted with Option 2 (`.config/gdlc/config.yml`, XDG-mirrored
project-relative path) recommended; the decision is not binding until status
moves to accepted.

**Action Required:** Maintainer review. On acceptance, issues #80–#84
implement against this chosen carrier and path convention.

### 2026-07-06

**Status:** Compliant

**Findings:**

| Finding                                                          | Files | Lines | Assessment |
| ----------------------------------------------------------------- | ----- | ----- | ---------- |
| Maintainer accepted Option 2 (`.config/gdlc/config.yml`); no open objections to the carrier, path-unification, or `board:` migration plan | - | - | compliant |

**Summary:** Maintainer review is complete; the decision is now binding.
Option 2 stands as drafted, with no changes to the chosen carrier, the
shared `gdlc/config.yml` path suffix, or the `board:` deprecation-fallback
plan.

**Action Required:** None for this ADR. Issues #80–#84 now implement
against this chosen carrier and path convention.

[adr-0003]: adr-0003-board-status-hygiene.md
