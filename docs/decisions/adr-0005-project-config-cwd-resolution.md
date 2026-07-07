---
title: "Upward Directory Search for Project Config, Plus a Resolution Diagnostic"
description: "loadGdlcConfig and readBoardConfig now search upward from cwd for .config/gdlc/config.yml, fixing a nested-cwd miss; get_session_context's new projectConfigPath field surfaces the outcome since a cwd that is an ancestor of the project remains a documented, unfixed gap."
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
created: 2026-07-07
updated: 2026-07-07
author: MIF Maintainers
project: gdlc
technologies:
  - node
  - xdg-base-directory
  - claude-code-plugins
audience:
  - developers
  - architects
  - maintainers
related:
  - adr-0004-project-config-surface.md
---

# ADR-0005: Upward Directory Search for Project Config, Plus a Resolution Diagnostic

## Status

Accepted

## Context

### Background and Problem Statement

Issue #106 reports that `loadGdlcConfig` (`mcp-server/src/config.ts`) and
`readBoardConfig`/`readLegacyBoardConfig` (`hooks/lib/in-progress.mjs`) both
resolve the project-config layer (ADR-0004) relative to the literal
`process.cwd()` of the running MCP server or hook, with no fallback and no
diagnostic when that exact directory doesn't hold `.config/gdlc/config.yml`.

The reported repro: in this org's own `modeled-information-format` workspace
(a non-git directory holding several repos under `repos/*`, per that
workspace's own `CLAUDE.md`), Claude Code's MCP server subprocess inherits
the *workspace's* cwd, not any individual repo's. `lsof -p <pid>` on a live
`github-sdlc-planning` MCP server confirmed `cwd =
/Users/AllenR1_1/Projects/modeled-information-format`, while the actual
config file lives at `repos/gdlc/.config/gdlc/config.yml` -- one level
*below* that cwd. `get_session_context` silently returned `projectBoard:
null`, identical to "no board configured anywhere," with no signal
distinguishing that from "a real config exists but wasn't reachable."

Issue #106 explicitly declined to prescribe a fix, asking that it be decided
deliberately, "possibly via a new ADR" -- naming climbing parent directories
(git-style upward search) or documenting the cwd requirement as two
candidate directions, or "something else."

### A geometric constraint the candidate options must be checked against

`.config/gdlc/config.yml` in the reported repro is a **descendant** of the
MCP server's cwd (`repos/gdlc` is one level below the workspace root), not an
ancestor of it. Git-style upward search -- climbing from cwd *toward* the
filesystem root -- only ever visits cwd's ancestors. It provably cannot find
a file in a descendant directory it doesn't already know about: climbing
further up moves strictly away from any child directory, never toward one.

This matters because upward search is the obvious, industry-precedented
answer (git, npm, and tsconfig all resolve a project root this way) and it
is one of the two directions issue #106 itself names -- but checked against
the *exact* topology in this issue's own repro, it does not close the gap
that motivated filing it. Any decision here has to be explicit about that,
not just adopt the familiar pattern and assume it applies.

## Decision Drivers

### Primary Decision Drivers

1. **Fix what upward search actually fixes, without overclaiming it fixes
   more.** A cwd nested *inside* a project root (e.g. an MCP server or hook
   launched from a build subdirectory) is a real, common case upward search
   solves correctly and safely.
2. **Don't silently guess across sibling repos.** A workspace cwd that is an
   ancestor of several repos (as in the reported case) has no signal in cwd
   alone that identifies *which* descendant repo a given tool call concerns
   -- inventing a downward probe (e.g. scanning `repos/*`) would encode one
   org's directory convention into a supposedly general loader, contradicting
   issue #106's own note that "any consumer running Claude Code from a
   parent/workspace directory... hits the same silent gap," not just this
   org's `repos/*` layout.
3. **Replace silent failure with an observable diagnostic**, per the issue's
   core complaint: a `null`/empty resolution should be distinguishable from
   "nothing is configured" versus "something is configured but wasn't
   reachable from here," even where the underlying gap isn't closed.

### Secondary Decision Drivers

1. **No behavior change for the common case.** A project run from its own
   root (the majority case today) must resolve identically before and after.
2. **No new runtime dependency**; `hooks/lib/in-progress.mjs` stays
   dependency-free per its own documented constraint.

## Considered Options

### Option 1: Git-style upward directory search only

**Description**: Climb from cwd toward the filesystem root looking for
`.config/gdlc/config.yml`, stopping at the first ancestor (including cwd
itself) that has it.

**Advantages**: Matches git/npm/tsconfig precedent; fixes the nested-cwd
case; fully backward-compatible (cwd-equals-root still resolves on the first
check).

**Disadvantages**: Does not fix the issue's own reported topology (workspace
cwd is an ancestor of the project, not nested inside it) -- adopting this
alone and calling the issue resolved would misrepresent what changed.

**Disqualifying Factor**: none on its own merits, but insufficient as the
*entire* decision given driver 3 (observability) is unmet for the reported
case.

**Risk Assessment**:

- **Technical Risk**: Low. Bounded directory-depth climb, no new
  dependency.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low. Additive; existing exact-cwd resolution keeps
  working identically.

### Option 2: Document the cwd requirement prominently, no code change

**Description**: Add documentation stating project config requires the MCP
server's cwd to equal the project root; no resolution logic changes.

**Advantages**: Zero risk; honest about the real constraint.

**Disadvantages**: Leaves the reported repro's silent failure exactly as
found -- `get_session_context` still returns `projectBoard: null`
indistinguishable from "nothing configured." Fixes nothing a user or agent
can act on without already knowing to read this document first, which is
exactly the discoverability problem issue #106 raises.

**Disqualifying Factor**: doesn't address driver 3 at all, and leaves driver
1's real, fixable nested-cwd case unfixed for no reason.

**Risk Assessment**:

- **Technical Risk**: None. Documentation-only.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low, but leaves the actual bug's symptom (silent
  `null`) live for every consumer that hits it.

### Option 3: Downward probe of a known subdirectory convention (e.g. `repos/*`)

**Description**: When cwd has no `.config/gdlc/config.yml` of its own, scan
immediate child directories for one.

**Advantages**: Would resolve the exact reported repro.

**Disadvantages**: Encodes this org's own `repos/*` workspace layout into a
supposedly general-purpose loader (issue #106 explicitly frames the gap as
affecting "any consumer," not just this workspace's convention); ambiguous
with multiple matching children (which sibling repo does an owner/repo-scoped
tool call concern?); unbounded-scan cost and surface-area risk scanning
directories a session may not even be about.

**Disqualifying Factor**: violates driver 2 outright -- it's exactly the
"silently guess across sibling repos" this ADR rules out, and doesn't
generalize past this org's own directory shape.

**Risk Assessment**:

- **Technical Risk**: Medium. Ambiguous-match handling and scan-depth
  bounding would need their own design.
- **Schedule Risk**: Medium.
- **Ecosystem Risk**: Medium. Hardcodes one org's workspace convention into
  a general-purpose loader other consumers would inherit.

### Option 4 (chosen): Upward search (Option 1) + an explicit resolution diagnostic

**Description**: Adopt upward search for the real, fixable nested-cwd case
(`findProjectConfigRoot` in `config.ts`, `findGdlcProjectRoot` in
`in-progress.mjs`). Additionally, expose the resolved project-config path (or
`null`) as a new `projectConfigPath` field on `get_session_context`'s result
(`resolveProjectConfigPath` in `config.ts`), so the previously-invisible
resolution outcome becomes observable: a caller can now distinguish "no
project config found from cwd upward" from "project config was found but has
no board configured." The multi-repo-workspace-ancestor gap (Option 3, ruled
out above) remains open and is the documented workaround path: configure the
**global** layer (`$XDG_CONFIG_HOME/gdlc/config.yml`) when running from a
workspace root above multiple repos, or invoke Claude Code with cwd set to
the specific repo.

**Advantages**: Fixes a real case (driver 1) without overclaiming; adds the
observability the issue asks for (driver 3) even for the case that remains
open; names the workaround explicitly instead of leaving it undiscoverable;
no new dependency, no behavior change for the common case (drivers 2, secondary
1-2).

**Disadvantages**: Does not close the exact reported repro's silent-null
symptom on its own -- the caller must still notice `projectConfigPath: null`
and know to check the global layer or their cwd. A fully general fix for the
ancestor-workspace case (e.g. an explicit caller-supplied project-root
override, since only the caller invoking a specific owner/repo tool call
knows which repo it concerns) is named as follow-on work, not built here --
it's a larger surface change (touching every config-consuming tool's
signature) that deserves its own design pass rather than folding it into this
ADR's scope.

**Risk Assessment**:

- **Technical Risk**: Low. Bounded directory-depth climb (typically single
  digits), the same pattern in both consuming files.
- **Schedule Risk**: Low.
- **Ecosystem Risk**: Low. Additive; the diagnostic field is new, existing
  fields and merge semantics are unchanged.

## Decision

We adopt **Option 4**: git-style upward search in both config readers, plus
a `projectConfigPath` diagnostic field on `get_session_context`, plus this
ADR's explicit documentation of the residual multi-repo-workspace-ancestor
gap and its workaround (use the global config layer, or run with cwd set to
the specific repo).

## Consequences

### Positive

1. A cwd nested inside a project root (a real, common launch pattern) now
   resolves the project layer correctly where it silently didn't before.
2. The previously invisible "was project config even reachable from here"
   question is now answerable from `get_session_context`'s own output.
3. The genuinely unresolved case is named and has a documented workaround,
   rather than being an undocumented surprise.

### Negative

1. The issue's specific reported repro (workspace root above multiple repos)
   is not fully closed by this change alone -- a caller must still notice
   the diagnostic and act on it.
2. `hooks/lib/in-progress.mjs` gains a small amount of duplicated logic
   (`findGdlcProjectRoot`) mirroring `config.ts`'s `findProjectConfigRoot`,
   consistent with that module's existing dependency-free-by-design
   duplication of `resolveGdlcConfigPath`/`resolveGlobalGdlcConfigRoot`.

### Neutral

1. An explicit caller-supplied project-root override (per-tool-call or via
   an env var) remains a live option for fully closing the ancestor-workspace
   gap, deliberately left as follow-on work rather than folded into this
   ADR's scope.

## Decision Outcome

The decision achieves its stated objective -- fix the real, safe subset of
the reported gap and make the rest observable -- measured by:
`findProjectConfigRoot`/`findGdlcProjectRoot` correctly resolve a project
root from a cwd nested inside it; `get_session_context` exposes
`projectConfigPath`; and this ADR records, rather than silently drops, the
finding that upward search alone cannot close the exact scenario issue #106
reported.

## Related Decisions

- [ADR-0004: One XDG-Mirrored Path for Global and Project Config][adr-0004] --
  established the `.config/gdlc/config.yml` carrier and path convention this
  ADR resolves against; this ADR does not change that carrier or path, only
  how the search for it starts.

## Links

- Issue [#106](https://github.com/modeled-information-format/gdlc/issues/106) --
  this ADR's tracking issue.
- [`docs/decisions/adr-0004-project-config-surface.md`](adr-0004-project-config-surface.md) --
  the carrier and path-unification decision this ADR builds on.

## More Information

- **Date:** 2026-07-07
- **Source:** Issue #106.
- **Related ADRs:** ADR-0004.

## Audit

### 2026-07-07

**Status:** Compliant

**Findings:**

| Finding | Files | Lines | Assessment |
| ------- | ----- | ----- | ---------- |
| Drafted and implemented together; upward search + diagnostic field match the decision recorded here | `mcp-server/src/config.ts`, `hooks/lib/in-progress.mjs`, `mcp-server/src/tools/session.ts` | - | compliant |

**Summary:** Decision and implementation land together; no open objections.

**Action Required:** None.

[adr-0004]: adr-0004-project-config-surface.md
