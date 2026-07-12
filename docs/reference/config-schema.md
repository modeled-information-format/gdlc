---
id: 20d89b34-8277-4da6-bd0f-0c2888c7a680
type: semantic
created: 2026-07-06T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-12T13:42:47.030Z'
title: Layered config schema (global + project)
diataxis_type: reference
provenance:
  '@type': Provenance
  agent: claude-code/claude-sonnet-5
  wasGeneratedBy:
    '@id': urn:mif:activity:claude-code-session:6587ad77-f582-49d4-9e1b-44734dc4b70a
    '@type': prov:Activity
  trustLevel: user_stated
  agentVersion: 2.1.207
---

Epic [#78](https://github.com/modeled-information-format/gdlc/issues/78)'s
layered global/project configuration system. The carrier and path were
decided by [ADR-0004](../decisions/adr-0004-project-config-surface.md)
(issue [#79](https://github.com/modeled-information-format/gdlc/issues/79));
this page is the schema those two layers share (issues
[#80](https://github.com/modeled-information-format/gdlc/issues/80) and
[#81](https://github.com/modeled-information-format/gdlc/issues/81)).
Machine-readable copy: [`schema/gdlc-config.schema.json`](../../schema/gdlc-config.schema.json).

## Authoring this file

Hand-editing the YAML directly against this page still works, but the
recommended path is the `configure-gdlc` agent/skill
([how-to](../how-to/configure-gdlc.md)), which reads the resolved state via
`get_gdlc_config`, elicits an explicit write target and section values, and
writes via `write_gdlc_config` — a schema-validated, CST-preserving write
(only the touched top-level section changes; comments/ordering elsewhere in
the file are untouched) rather than a full-file rewrite. See
[ADR-0009](../decisions/adr-0009-configure-gdlc-agent-contract.md) for the
write-path contract these two tools implement.

## Files and resolution

Both layers are plain YAML, no frontmatter wrapper, same relative suffix.
One function computes the file path given a root:
`resolveConfigPath(root) => path.join(root, 'gdlc', 'config.yml')`; the two
layers differ only in which root(s) they hand it (issue #82's original
implementation; [ADR-0008](../decisions/adr-0008-project-config-n-ancestor-resolution.md)
extended the project side from one root to N, see *Cascade* below):

| Layer | Root(s) passed to `resolveConfigPath` | Resulting path(s) |
| --- | --- | --- |
| Global | `$XDG_CONFIG_HOME` (env var, default `~/.config`) | `$XDG_CONFIG_HOME/gdlc/config.yml` |
| Project | `<ancestor>/.config`, for **every** `<ancestor>` of `cwd` up to `$HOME` (exclusive) that has one | `<ancestor>/.config/gdlc/config.yml`, one per matching ancestor |

The project root is *not* passed to `resolveConfigPath` directly — the
caller joins on `.config` first, since `$XDG_CONFIG_HOME` (the global
root) already points at what `.config` conceptually is for that layer;
passing the bare project root would resolve to
`<projectRoot>/gdlc/config.yml`, missing the `.config/` segment entirely.
Neither file is required to exist; a missing file is an empty config at
that layer, not an error. An ancestor whose resolved path collides with
the global layer's own resolved path is skipped (not treated as a project
match), without stopping the climb toward `$HOME`.

## Schema

```yaml
targeting:
  allowRepos: ["org/repo"]   # optional; omitted/empty = no restriction
  allowOrgs: ["org"]          # optional; omitted/empty = no restriction
destination:
  repo: "org/repo"            # optional; default destination for posted issues
board:
  projectOwnerLogin: "org-or-user"
  projectNumber: 1
  projectOwnerType: "organization"  # or "user"; default "organization"
packs:
  hooks: true                # optional; enhancement-pack opt-in toggles
  triage-skills: true         # (github-bug-capture: hooks, triage-skills,
  mcp-integration: false      # mcp-integration, gh-aw; github-sdlc-planning:
  gh-aw: false                # skipMutationConfirm). Keyed by pack name ->
  skipMutationConfirm: false  # boolean; unset = disabled (fail-closed).
prLifecycle:
  enabled: false                                     # optional; default false (fail-closed)
  localReviewer: "/code-review --fix"                 # optional; default shown
  requireLocalReview: true                            # optional; default true once enabled
  requireCopilotReview: true                          # optional; default true once enabled
  requireCleanCodeScanning: true                      # optional; default true once enabled
```

`targeting` and `destination` are new (issue #78's capture-scope and
posting-destination requirements; no prior carrier existed for them).
`board` supersedes the `board:` key formerly shipped in
`.claude/github-sdlc-planning.local.md` (see *History* below). `packs`
supersedes `github-bug-capture`'s `packs:` map formerly shipped in
`.claude/github-bug-capture.local.md` ([ADR-0006](../decisions/adr-0006-eliminate-markdown-config-carriers.md)):
after that ADR, no `.claude/<plugin>.local.md` config carrier remains
anywhere in the plugin suite. `prLifecycle` (issue #185) is the newest
section — see *PR-lifecycle enforcement* below.

## Cascade: nearest-ancestor-per-section wins, then global

The loader merges **per top-level section** (`targeting`, `destination`,
`board`, `packs`, `prLifecycle`), not per leaf key and not deep-merged
arrays. [ADR-0008](../decisions/adr-0008-project-config-n-ancestor-resolution.md)
extended the original single-project-layer cascade
([ADR-0004](../decisions/adr-0004-project-config-surface.md)) to search
**every** ancestor directory between `cwd` and `$HOME` (not just the
nearest one): for each section independently, the value comes from the
**nearest ancestor whose config file actually, validly defines that
section** — falling through to a further ancestor, and only then to the
global layer, if a nearer ancestor's file doesn't define the section at
all. This matches the epic's "closer-to-project wins" direction without an
ambiguous array-concatenation rule for `allowRepos`/`allowOrgs`.

**"Actually, validly defines" is section-specific, not a generic header
check.** Each section's own presence rule is the single source of truth —
there is no separate, independently-maintained "does this ancestor define
section X" predicate (an earlier draft of this design tried that; it
disagreed with the real parser for a nearer ancestor whose section header
was present but resolved to zero valid content, and was reverted before
merging — see ADR-0008's Context for the full account):

| Section | "Present" means |
| --- | --- |
| `targeting`, `destination`, `packs` | At least one key under the section header parses to a valid value. A header with no valid children (e.g. comment-only, or every key malformed) does **not** count as present, and the search continues to the next ancestor. |
| `board` | The `board:` header line exists at all — even with zero or invalid children. A present-but-invalid `board:` section stops the cascade there (resolves to "not configured", `null`), it does **not** fall through to a further ancestor or the global layer. This is a deliberate, narrower rule than the other sections: the same file must resolve identically whether a hook or an MCP tool reads it, and `board`'s validation (both `projectOwnerLogin` and `projectNumber` required) happens at a different layer than presence. |
| `prLifecycle` | At least one key under the section header parses to a valid value (same rule as `packs`). |

**Concrete example** — a nested repo's own config shadows only `board:`,
letting an ancestor's `packs:` still apply:

```yaml
# <workspace-root>/.config/gdlc/config.yml (an ancestor of the repo below)
packs:
  skipMutationConfirm: true
```

```yaml
# <workspace-root>/repos/some-repo/.config/gdlc/config.yml (the repo itself)
board:
  projectOwnerLogin: acme
  projectNumber: 1
```

A session with `cwd` at or under `<workspace-root>/repos/some-repo`
resolves `board` from the repo's own file (`acme`/`1`) and `packs` from
the workspace-root ancestor (`skipMutationConfirm: true`) — the repo's
own file, having no `packs:` section at all, does not shadow the
ancestor's real value and does not force a fall-through to the global
layer for that section.

## PR-lifecycle enforcement (issue #185)

`prLifecycle` gates the PR lifecycle `github-pull-requests`' hooks enforce
around `create_pull_request`: a local-review reminder before the tool runs,
a Copilot-review reminder after, and (via the `check_pr_readiness`
tool/CLI script) a single settled/not-settled verdict combining checks,
review state, review-thread resolution, and code-scanning alerts.
Fail-closed like every other opt-in section here: an absent or
`enabled: false` section means none of this runs, so an existing repo
that has never heard of this feature sees no new prompts. `resolvePrLifecycleConfig`
(`plugins/github-sdlc-planning/mcp-server/src/config.ts`) is where the
`require*` sub-toggle and `localReviewer` defaults get applied — the raw
`GdlcConfig.prLifecycle` type leaves every field optional.

**`localReviewer` is read, never executed.** A hook can only spawn an OS
process (`node`/`bash`) — it cannot invoke a Claude Code slash command or
skill. `localReviewer`'s default, `/code-review --fix`, is a
slash command; the pre-PR hook surfaces it as an instruction
(`permissionDecisionReason`) the agent must act on, the same
legible-confirmation pattern `github-sdlc-planning`'s `confirm-mutation.mjs`
already uses, not a command the hook process runs itself.

Note this is bare `/code-review` — Claude Code's own native, current-diff
review command, which can run before a PR exists — not the plugin-qualified
`/code-review:code-review`. That qualified form resolves to the separate
`code-review@claude-plugins-official` marketplace plugin, which only reviews
an already-open PR (`gh pr diff`/`gh pr view`) and has no `--fix` handling;
naming it here would make this gate unsatisfiable pre-PR.

## History: the two retired markdown carriers

Two `.claude/<plugin>.local.md` markdown carriers existed before this
schema absorbed both of them; neither is read anymore.

- **The legacy `board:` key** in `.claude/github-sdlc-planning.local.md`
  (`docs/how-to/plan-work-with-the-plugins.md` step 3, historical). ADR-0004
  superseded it with `.config/gdlc/config.yml`'s `board:` section and kept
  it working "for one release" with a deprecation notice; ADR-0006 removed
  the fallback entirely once that window closed.
- **The `packs:` map** in `.claude/github-bug-capture.local.md`. ADR-0004
  originally kept this local-only on purpose — a personal, uncommitted,
  per-developer runtime toggle should not share a carrier with team-shared,
  committed policy. [ADR-0006](../decisions/adr-0006-eliminate-markdown-config-carriers.md)
  reversed that call explicitly, accepting the trade-off it names: pack
  toggles are now committed, team-shared policy in `.config/gdlc/config.yml`'s
  `packs:` section, the same as `targeting`/`destination`/`board`.

## Where the loader lives

The config-loader is Layer-1 (portable-core) scope, not a Claude-Code-only
enhancement: `targeting`/`destination`/`board` values must resolve
identically for any MCP host, matching
[ADR-0001](../decisions/adr-0001-bug-capture-layer1-core.md)'s core/enhancement
split. It ships as `plugins/github-sdlc-planning/mcp-server/src/config.ts`
(issue #82), exported via a `./config` subpath on that package — the same
subpath-export mechanism already used for `mif.ts`:
`github-sdlc-planning/mcp-server/package.json` defines the `exports` map,
and `github-pull-requests` consumes it via a `file:` dependency (see
`plugins/github-pull-requests/mcp-server/package.json`).

**New dependency edge, decided here.** `github-bug-capture` has no existing
direct dependency on `github-sdlc-planning` — today it only depends on
`github-pull-requests` (`.claude-plugin/plugin.json`), which in turn depends
on `github-sdlc-planning` (ADR-0001/0002's composition chain). Consuming
`config.ts` directly requires a **new, direct** edge: a `file:` dependency
in `github-bug-capture/mcp-server/package.json` on
`@github-sdlc-plugins/github-sdlc-planning-mcp-server`, plus a matching
`{ "name": "github-sdlc-planning" }` entry in `github-bug-capture`'s
`plugin.json` `dependencies[]`. This is a pure-utility import (parse/merge,
no tool invocation and no shared state), the same kind of edge `mif.ts`
already is for `github-pull-requests` — not the MCP-subprocess composition
ADR-0002 reserves for owned business logic like PR-issue linkage. Issue
#82/#83's implementation PR adds this edge explicitly.

The one exception is each plugin's **hooks** layer, which is deliberately
dependency-free (no `node_modules` available at hook-execution time) and
cannot import an npm-backed module: `github-sdlc-planning`'s
`hooks/lib/in-progress.mjs` (`board:`) and `hooks/lib/settings.mjs`
(`packs:`, added for issue #183's `skipMutationConfirm` toggle),
`github-bug-capture`'s own `hooks/lib/settings.mjs` (`packs:`), and
`github-pull-requests`'s `hooks/lib/pr-lifecycle-config.mjs`
(`prLifecycle:`), each keep their own minimal, dependency-free reader for
`.config/gdlc/config.yml`'s plain-YAML sections, rather than sharing code
with the MCP-server loader or with each other. All four (plus `config.ts`
itself) implement [ADR-0008](../decisions/adr-0008-project-config-n-ancestor-resolution.md)'s
N-ancestor climb identically in shape — an existence-only directory walk
(`findAllProjectConfigPaths`/`findAllGdlcProjectConfigPaths`) feeding each
section's own real presence-checking parser — kept behaviorally identical
on purpose (issue #83's review caught and fixed a real divergence between
the two `board:` readers; ADR-0008's own review caught and fixed a sharper
one between the N-ancestor climb's *first* implementation attempt and
`config.ts`) — see *Verified end-to-end* below.

## Verified end-to-end (issue #84)

A project value overriding a global default, confirmed against the built
`dist/config.js` and the hooks-layer reader independently, given:

```yaml
# $XDG_CONFIG_HOME/gdlc/config.yml (global)
board:
  projectOwnerLogin: acme-global
  projectNumber: 1
destination:
  repo: "acme/global-default-repo"
```

```yaml
# <projectRoot>/.config/gdlc/config.yml (project)
board:
  projectOwnerLogin: acme-project
  projectNumber: 42
```

```console
$ cd <projectRoot> && XDG_CONFIG_HOME=<global root> node -e \
  "import('<gdlcRepoRoot>/plugins/github-sdlc-planning/mcp-server/dist/config.js').then(m => \
     console.log(JSON.stringify(m.loadGdlcConfig(process.cwd()), null, 2)))"
{
  "destination": {
    "repo": "acme/global-default-repo"
  },
  "board": {
    "projectOwnerLogin": "acme-project",
    "projectNumber": 42
  }
}
```

The project's `board` section replaces the global one wholly
(`acme-project`/`42`, not `acme-global`/`1`); the global's `destination`
shows through untouched, since the project file doesn't define that
section at all — exactly the section-wise cascade above. The
hooks-layer `readBoardConfig()` resolves the identical pair of files to
the same `projectOwnerLogin`/`projectNumber` --
`{ projectOwnerLogin: "acme-project", projectNumber: 42, projectOwnerType: "organization" }`.
The extra `projectOwnerType` key is expected, not a divergence:
`readBoardConfig` (like `resolveBoardCoordinates`) always fills it with
the `"organization"` default when the YAML omits it, while
`loadGdlcConfig`'s raw merged config only carries a key that was actually
present in a source file — the two readers agree on every field the
*schema* defines, they just return that field at different stages
(raw merged config vs. a fully-defaulted board-coordinates result).
