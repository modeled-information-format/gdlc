---
id: 20d89b34-8277-4da6-bd0f-0c2888c7a680
type: semantic
created: 2026-07-06T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-09T00:00:00Z
title: Layered config schema (global + project)
diataxis_type: reference
---

Epic [#78](https://github.com/modeled-information-format/gdlc/issues/78)'s
layered global/project configuration system. The carrier and path were
decided by [ADR-0004](../decisions/adr-0004-project-config-surface.md)
(issue [#79](https://github.com/modeled-information-format/gdlc/issues/79));
this page is the schema those two layers share (issues
[#80](https://github.com/modeled-information-format/gdlc/issues/80) and
[#81](https://github.com/modeled-information-format/gdlc/issues/81)).
Machine-readable copy: [`schema/gdlc-config.schema.json`](../../schema/gdlc-config.schema.json).

## Files and resolution

Both layers are plain YAML, no frontmatter wrapper, same relative suffix.
One function computes the file path given a root:
`resolveConfigPath(root) => path.join(root, 'gdlc', 'config.yml')`; the two
layers differ only in which root they hand it (issue #82's implementation,
`loadGdlcConfig`):

| Layer | Root passed to `resolveConfigPath` | Resulting path |
| --- | --- | --- |
| Global | `$XDG_CONFIG_HOME` (env var, default `~/.config`) | `$XDG_CONFIG_HOME/gdlc/config.yml` |
| Project | `<projectRoot>/.config` | `<projectRoot>/.config/gdlc/config.yml` |

The project root is *not* passed to `resolveConfigPath` directly — the
caller joins on `.config` first, since `$XDG_CONFIG_HOME` (the global
root) already points at what `.config` conceptually is for that layer;
passing the bare project root would resolve to
`<projectRoot>/gdlc/config.yml`, missing the `.config/` segment entirely.
Neither file is required to exist; a missing file is an empty config at
that layer, not an error.

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
  localReviewer: "/code-review:code-review --fix"     # optional; default shown
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

## Cascade: project overrides global, section-wise

The loader merges **per top-level section** (`targeting`, `destination`,
`board`, `packs`, `prLifecycle`), not per leaf key and not deep-merged arrays: if the project file
defines a section, that section's value from the project file is used
whole; otherwise the global file's value for that section is used;
otherwise the section is absent. This matches the epic's "closer-to-project
wins" direction without an ambiguous array-concatenation rule for
`allowRepos`/`allowOrgs`.

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
skill. `localReviewer`'s default, `/code-review:code-review --fix`, is a
slash command; the pre-PR hook surfaces it as an instruction
(`permissionDecisionReason`) the agent must act on, the same
legible-confirmation pattern `github-sdlc-planning`'s `confirm-mutation.mjs`
already uses, not a command the hook process runs itself.

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
(`packs:`, added for issue #183's `skipMutationConfirm` toggle), and
`github-bug-capture`'s own `hooks/lib/settings.mjs` (`packs:`), each keep
their own minimal, dependency-free reader for `.config/gdlc/config.yml`'s
plain-YAML sections, rather than sharing code with the MCP-server loader or
with each other. Both `board:` readers are kept behaviorally identical on
purpose (issue #83's review caught and fixed a real divergence between
them) — see *Verified end-to-end* below. Both `settings.mjs` `packs:`
readers (ADR-0006) mirror the same parsing/resolution pattern
`in-progress.mjs` proved out for `board:`.

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
