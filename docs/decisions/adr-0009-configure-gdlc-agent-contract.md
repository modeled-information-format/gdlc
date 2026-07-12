---
title: "configure-gdlc Agent Contract"
description: "write_gdlc_config never infers its target via ancestor search (explicit layer+root only), preserves untouched YAML via parseDocument()-based targeted mutation (never stringify a parsed object), and validates via a zod schema mirroring gdlc-config.schema.json instead of a new ajv dependency."
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
  - yaml
  - validation
status: accepted
created: 2026-07-12
updated: 2026-07-12
author: MIF Maintainers
project: gdlc
technologies:
  - node
  - typescript
  - yaml
  - zod
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0004-project-config-surface.md
  - adr-0005-project-config-cwd-resolution.md
  - adr-0008-project-config-n-ancestor-resolution.md
---

# ADR-0009: configure-gdlc Agent Contract

## Status

Accepted

## Context

### Background and Problem Statement

Epic #253 adds an elicitation agent (`configure-gdlc`) that authors
`.config/gdlc/config.yml` (project and global layers) instead of requiring
users to hand-write it. Story #256 needs two new MCP tools —
`get_gdlc_config` (read) and `write_gdlc_config` (write) — and Story #260's
agent needs a preview-before-write step. This ADR settles three questions
the implementing Tasks (#257/#258) must not improvise:

1. How does a write serialize the file back to disk?
2. How does a write pick which physical file to touch?
3. How does a write validate the config it's about to write?

`config.ts` (ADR-0004/0005/0008) already owns **reads**: `loadGdlcConfig`
merges the global layer with every ancestor project-layer file, nearest
wins per section, found by upward search from `process.cwd()`. This ADR
does not change any of that — it only adds a **write** path, which is a
different, higher-consequence operation than a read and does not inherit
the read path's resolution semantics by default.

Two concrete gaps were identified while scoping this epic:

- **Reformatting risk.** `.config/gdlc/config.yml` is a committed,
  PR-reviewed file. A naive write (`YAML.parse()` to a plain object,
  mutate, `YAML.stringify()` back) reformats the *entire* file — losing
  comments, key ordering, and quoting style — on every write, even one that
  only touches a single section. A PR diff for a one-line config change
  would show the whole file rewritten.
- **Ambiguous write target.** `get_session_context`'s
  `findAllProjectConfigPaths` (ADR-0008) climbs from `process.cwd()` toward
  `$HOME`, and can resolve an ancestor directory's config file when the
  session's cwd is nested inside a larger workspace (as happened live while
  scoping this epic: a call from a nested repo resolved a workspace-root
  config file, not a repo-local one). That ancestor-search behavior is
  correct and intentional for *reads* — but reusing it as the default write
  target would mean an agent invoked from a nested cwd could silently edit
  a file the user didn't expect to be touched, shared by sibling projects.

### Constraints

- Must not introduce a new dependency with a known-vulnerable transitive
  chain when an existing dependency already covers the need — this
  marketplace already avoided `ajv`/`ajv-cli` elsewhere in this workspace
  for exactly this reason (unpatched `fast-json-patch` transitive, GHSA-8gh8-hqwg-xf34).
  `zod` (`^4.4.3`) is already a direct dependency of this package.
- Must not duplicate `config.ts`'s existing read-side cascade — `get_gdlc_config`
  wraps `loadGdlcConfig`/`findAllProjectConfigPaths`, it does not reimplement them.
- The elicitation agent (Story #260) needs to show the user an accurate
  diff before writing anything for real.

## Decision Drivers

### Primary Decision Drivers

1. **File-preservation matters as much as correctness.** A write that
   produces a technically-correct but wholesale-reformatted file fails the
   epic's own "accurately" requirement in spirit — the review burden on a
   one-line config change should not become "review the entire file."
2. **A write's target must be a deliberate choice, never an inferred
   side-effect.** The read path's upward ancestor search is a convenience
   for *finding* config; applying the same convenience to *writing*
   config trades a small UX convenience for a real risk of editing the
   wrong file.

### Secondary Decision Drivers

1. **Reuse over new dependencies.** Validation should reuse what's already
   in the dependency graph and already covers the schema's constraints,
   rather than adding a parser/validator with its own security surface.
2. **Preview before commit.** The agent needs to show real proposed bytes,
   not a description of intended changes, before the user confirms a write.

## Considered Options

Three independent dimensions had to be decided; each is listed as its own
set of options below (A = serialization strategy, B = write-target
resolution, C = validation approach). The Decision section adopts one
option per dimension.

### Option A1: `YAML.parse()` → mutate plain object → `YAML.stringify()`

**Description**: Parse the file to a plain JS object, mutate the target
section, serialize the whole object back with `YAML.stringify()`.

**Advantages**:

- Simplest to implement; every existing reader in `config.ts` already uses
  `parse()`, so this reuses a familiar shape.

**Disadvantages**:

- `stringify()` re-emits the *entire* document from the parsed object,
  discarding comments, key ordering, and quoting/anchors for every section
  — including ones the write didn't touch.
- For a committed, PR-reviewed file, this turns every write into a
  full-file reformat diff, defeating the reviewability the file relies on.

**Risk Assessment**:

- **Technical Risk**: Low to implement, but high correctness risk against
  this ADR's own file-preservation driver.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium — every consumer who hand-edits this file
  loses their formatting/comments the next time any tool writes to it.

**Disqualifying Factor**: violates the file-preservation decision driver
directly; rejected.

### Option A2: regex/line-based text surgery

**Description**: Locate the target top-level key by regex against the raw
file text and splice in replacement lines directly, without a YAML parser.

**Advantages**:

- No new API to learn beyond string manipulation.

**Disadvantages**:

- Fragile — YAML's own indentation/quoting/multi-line-string rules are
  non-trivial to reproduce correctly by hand.
- Duplicates parsing logic the `yaml` package already provides correctly,
  with a real risk of producing invalid YAML on an edge case (nested
  structures, existing comments adjacent to the target key).

**Risk Assessment**:

- **Technical Risk**: High — hand-rolled YAML mutation is exactly the kind
  of narrow parser this ecosystem already avoids elsewhere (`config.ts`'s
  own doc comments note preferring real parsers over regex where behavior
  must match across independent readers).
- **Schedule Risk**: Medium — edge cases surface after the fact.
- **Ecosystem Risk**: Medium.

**Disqualifying Factor**: reimplements a solved problem (YAML CST
preservation) with a fragile ad hoc mechanism; rejected.

### Option A3: `YAML.parseDocument()` + targeted `Document.set()` mutation (chosen)

**Description**: Parse with the `yaml` package's `Document` API (already a
direct dependency), mutate only the top-level key(s) being written via
`Document.set()`, re-serialize with `.toString()`.

**Advantages**:

- Preserves the original CST (comments, ordering, formatting) for every
  key not explicitly mutated; a write touching `board:` leaves
  `packs:`/`prLifecycle:`/any comments byte-identical.
- No new dependency — the `yaml` package is already used throughout
  `config.ts`.

**Disadvantages**:

- Slightly more code than a plain `parse`/`stringify` round trip (must
  operate on the `Document` API rather than a plain object).

**Risk Assessment**:

- **Technical Risk**: Low — the `yaml` package's `Document` API is
  designed exactly for this use case.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low.

### Option B1: reuse `findProjectConfigRoot`'s ancestor search as the write default

**Description**: Symmetrical with the read path — a write with no explicit
target climbs from `process.cwd()` toward `$HOME` and writes to the
nearest ancestor's `.config/gdlc/config.yml` it finds (or creates one at
`process.cwd()` if none exists).

**Advantages**:

- Least new API surface; matches the read path's existing convenience.

**Disadvantages**:

- A write is a higher-consequence operation than a read. The same
  convenience that helps a read find "the nearest relevant config" can
  silently pick the wrong file to *mutate* when the session's cwd is
  nested inside a larger workspace — concretely observed while scoping
  this epic (a call from a nested repo resolved a workspace-root config
  file, not a repo-local one).
- A user invoking the `configure-gdlc` agent from a nested cwd could have
  a shared ancestor file silently edited on their behalf.

**Risk Assessment**:

- **Technical Risk**: Low to implement, but high correctness risk (wrong
  file silently mutated).
- **Schedule Risk**: Low.
- **Ecosystem Risk**: High — a shared ancestor config file affects every
  sibling project under it; an unintended edit there has wide blast radius.

**Disqualifying Factor**: directly reintroduces the ambiguous-write-target
gap this ADR exists to close; rejected.

### Option B2: explicit `layer`/`root`, never inferred (chosen)

**Description**: `write_gdlc_config` always requires an explicit
`layer: 'project' | 'global'` and, for `'project'`, an explicit `root`
(defaulting to `process.cwd()`, never an ancestor-search result). It never
calls `findProjectConfigRoot`/`findAllProjectConfigPaths` to pick a target.

**Advantages**:

- A write can never silently land on a file the invoking user didn't
  expect, regardless of what cwd the session happens to be nested under.
- `get_gdlc_config`'s diagnostics (every layer path checked, whether it
  exists, which sections it contributes) gives the `configure-gdlc` agent
  everything it needs to surface an already-found ancestor file as
  *information* — "an ancestor at X already sets `board:`" — letting the
  user explicitly choose to edit it (pass its directory as `root`), create
  a new project-local file at the cwd, or target the global layer.

**Disadvantages**:

- Slightly more agent-side complexity: the agent must explicitly ask
  rather than a single default resolving automatically the way reads do.

**Risk Assessment**:

- **Technical Risk**: Low.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low — strictly reduces risk relative to B1.

### Option B3: write only ever targets `process.cwd()`, no global option

**Description**: Drop the `layer` argument entirely; every write targets
`<process.cwd()>/.config/gdlc/config.yml`.

**Advantages**:

- Simplest possible API — one less argument, one less branch.

**Disadvantages**:

- The global layer (issue #80) is a legitimate, already-shipped config
  surface; a project-agent Story that can't configure it at all would be
  incomplete relative to what `config.ts` already supports on the read side.

**Risk Assessment**:

- **Technical Risk**: Low.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium — under-serves a real, already-shipped use case.

**Disqualifying Factor**: leaves a documented, already-shipped config layer
(global) unreachable from the new write tool; rejected.

### Option C1: add `ajv` + `ajv-cli` for direct JSON Schema validation

**Description**: Validate the proposed config directly against
`schema/gdlc-config.schema.json` using `ajv`/`ajv-cli`.

**Advantages**:

- Most direct reuse of the existing schema file — one schema
  representation, not two.

**Disadvantages**:

- This workspace has already hit `ajv-cli@5.0.0`'s vulnerable transitive
  `fast-json-patch` dependency (GHSA-8gh8-hqwg-xf34) elsewhere and
  deliberately avoided it in favor of a thin wrapper over `ajv`/`ajv-formats`
  directly. Pulling in `ajv-cli` here reintroduces exactly that avoided
  dependency; even bare `ajv` is a new dependency for a schema simple
  enough for Option C2 to cover without one.

**Risk Assessment**:

- **Technical Risk**: Low technically, but reintroduces a known-avoided
  vulnerable dependency chain if `ajv-cli` specifically is used.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium — a new dependency with its own security
  surface, avoidable given C2 covers the same constraints.

**Disqualifying Factor**: reintroduces a dependency this workspace already
identified and avoided elsewhere for the same class of risk; rejected.

### Option C2: hand-written `zod` schema mirroring the JSON Schema (chosen)

**Description**: A `zod` schema in the MCP server expressing the same
constraints as `schema/gdlc-config.schema.json` (string patterns for
`org/repo`, positive integers, enums, `additionalProperties: false`).

**Advantages**:

- `zod` (`^4.4.3`) is already a direct dependency of this package — no new
  dependency, no new security surface.
- The schema's constraints are all directly expressible in zod without a
  JSON-Schema-to-zod bridge library.

**Disadvantages**:

- Two schema representations (the zod schema and the JSON Schema file)
  describe the same shape independently and must be kept in sync by hand;
  a future schema change (as already happened once for real: #247/#248)
  must update both, with no automated check that they agree.

**Risk Assessment**:

- **Technical Risk**: Low.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low, with one accepted piece of ongoing debt (the
  dual-schema sync burden, recorded under Consequences below).

### Option C3: treat `config.ts`'s existing `normalizeConfig` as the sole validator

**Description**: Reuse the existing fail-soft `normalizeConfig` reader
(used today by `loadGdlcConfig` for reads) as the only validation step
before a write.

**Advantages**:

- Zero new validation code; maximal reuse of what already exists.

**Disadvantages**:

- `normalizeConfig` is deliberately fail-soft — a malformed section is
  silently dropped, not rejected, which is the right contract for a *read*
  (a hand-edited file with one bad section shouldn't break every tool that
  reads it). A *write* needs the opposite contract: reject invalid input
  outright rather than silently coercing or dropping it. Reusing it alone
  would silently accept a write request with a malformed section instead
  of failing it.

**Risk Assessment**:

- **Technical Risk**: Low to implement, but wrong correctness contract for
  a write path.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Medium — a write tool that silently drops invalid
  input instead of rejecting it directly undermines the epic's "accurately"
  requirement.

**Disqualifying Factor**: fail-soft is the wrong contract for a write path;
rejected.

## Decision

Adopt **A3 + B2 + C2**:

- `write_gdlc_config` serializes via `YAML.parseDocument()` and targeted
  `Document.set(sectionKey, value)` calls for only the section(s) being
  written, then `.toString()` — never `parse()`-to-object-then-`stringify()`.
- `write_gdlc_config` takes a required `layer: 'project' | 'global'` and,
  for `'project'`, a `root` defaulting to `process.cwd()` — it never calls
  any ancestor-search function to choose a target. `get_gdlc_config`'s
  diagnostics (every layer path checked, whether it exists, which sections
  it contributes) is how the `configure-gdlc` agent surfaces an existing
  ancestor file to the user as information for them to explicitly act on.
- Validation is a hand-written `zod` schema in the MCP server mirroring
  `schema/gdlc-config.schema.json`'s constraints — no new dependency.
- `write_gdlc_config` supports `dryRun: true`, returning the post-write
  file content (or a diff) without touching disk, for the agent's
  confirm-before-write step.

## Consequences

### Positive

1. A config write's PR diff shows only the section actually changed —
   the reviewability this file already relies on (it's committed and
   team-shared) is preserved, not degraded by tooling.
2. A write can never silently land on a file the invoking user didn't
   expect, regardless of what cwd the session happens to be nested under.
3. No new dependency, no new security surface, matching this workspace's
   prior `ajv-cli` avoidance elsewhere.

### Negative

1. **Two schema representations to keep in sync.** The zod schema
   (write-side) and `schema/gdlc-config.schema.json` (documented contract,
   also used by Story #264's CI gate) describe the same shape independently.
   A future schema change (as already happened once for real: #247/#248)
   must update both, and nothing currently catches a divergence
   automatically. Accepted as debt for this epic; a follow-up issue for an
   equivalence test (construct both, assert they accept/reject the same
   fixture set) is reasonable but not required to unblock #256/#264.
2. **Slightly more agent-side complexity.** The agent must explicitly
   surface and let the user choose among "edit found ancestor" / "create
   new project-local file" / "write global," rather than a single default
   ancestor-search resolving automatically the way reads do.

### Neutral

1. `write_gdlc_config`'s `dryRun` is a flag on the same tool rather than a
   separate `validate_gdlc_config` tool — fewer tools, same capability;
   Story #256's Task #258 implements it this way.

## Decision Outcome

The decision achieves its objective — a write path that preserves file
formatting, never infers its target, and validates without a new
dependency — measured by: `write_gdlc_config`'s implementation (Task #258)
using `YAML.parseDocument()`/`Document.set()` (never `stringify()` on a
parsed object), a required explicit `layer`/`root` argument with no
ancestor-search call anywhere in the write path, and a zod schema covering
every constraint in `schema/gdlc-config.schema.json`.

## Related Decisions

- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004] —
  the carrier/path design this ADR writes against, unchanged.
- [ADR-0005: Project Config cwd Resolution][adr-0005] and
  [ADR-0008: N-Ancestor, Per-Section Project Config Resolution][adr-0008] —
  the read-side ancestor-search behavior this ADR deliberately does **not**
  extend to writes.

## Links

- Epic [#253](https://github.com/modeled-information-format/gdlc/issues/253).
- Story [#254](https://github.com/modeled-information-format/gdlc/issues/254) — this ADR's tracking issue.
- Task [#255](https://github.com/modeled-information-format/gdlc/issues/255) — implements this ADR.
- Story [#256](https://github.com/modeled-information-format/gdlc/issues/256) / Tasks [#257](https://github.com/modeled-information-format/gdlc/issues/257)/[#258](https://github.com/modeled-information-format/gdlc/issues/258) — build the tools this ADR specifies.
- Story [#264](https://github.com/modeled-information-format/gdlc/issues/264) — the CI schema gate that also depends on this ADR's validation-approach decision (C2).

## More Information

- **Date:** 2026-07-12
- **Source:** Epic #253; Story #254.
- **Related ADRs:** ADR-0004, ADR-0005, ADR-0008.

## Audit

### 2026-07-12

**Status:** Pending

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Drafted as proposed; awaiting maintainer review | - | - | pending |

**Summary:** Drafted with A3/B2/C2 recommended; the decision is not binding until status moves to accepted.

**Action Required:** Maintainer review. On acceptance, Tasks #257/#258/#265 implement against this chosen contract.

### 2026-07-12

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| --- | --- | --- | --- |
| Maintainer accepted A3/B2/C2 via PR #268 (merged, Copilot-reviewed clean, no requested changes); no open objections to the write-preservation, write-target, or validation decisions | - | - | compliant |

**Summary:** Maintainer review is complete; the decision is now binding. A3/B2/C2 stand as drafted, with no changes to the chosen contract.

**Action Required:** None for this ADR. Tasks #257/#258/#265 now implement against this chosen contract.

[adr-0004]: adr-0004-project-config-surface.md
[adr-0005]: adr-0005-project-config-cwd-resolution.md
[adr-0008]: adr-0008-project-config-n-ancestor-resolution.md
