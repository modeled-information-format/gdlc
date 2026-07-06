---
id: 20d89b34-8277-4da6-bd0f-0c2888c7a680
type: semantic
created: 2026-07-06T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-06T00:00:00Z
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

> ADR-0004's acceptance is staged in [PR #97](https://github.com/modeled-information-format/gdlc/pull/97),
> not yet merged as of this page's writing. The link above 404s until #97
> merges to `main`; merge #97 before (or together with) this page.

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
```

`targeting` and `destination` are new (issue #78's capture-scope and
posting-destination requirements; no prior carrier existed for them).
`board` supersedes the `board:` key previously shipped in
`.claude/github-sdlc-planning.local.md` (see *Migration* below).

## Cascade: project overrides global, section-wise

The loader merges **per top-level section** (`targeting`, `destination`,
`board`), not per leaf key and not deep-merged arrays: if the project file
defines a section, that section's value from the project file is used
whole; otherwise the global file's value for that section is used;
otherwise the section is absent. This matches the epic's "closer-to-project
wins" direction without an ambiguous array-concatenation rule for
`allowRepos`/`allowOrgs`.

## Migration: the legacy `board:` key

The config-loader (issue #82) tries `.config/gdlc/config.yml`'s `board`
section first. If that section is absent, it falls back for one release to
the legacy `board:` map in `.claude/github-sdlc-planning.local.md`
(`docs/how-to/plan-work-with-the-plugins.md` step 3), emitting one
deprecation notice on first use. `.claude/<plugin>.local.md` files
otherwise keep their original, narrower purpose: personal, uncommitted,
per-developer runtime toggles (e.g. github-bug-capture's `packs:` map),
never team-shared targeting/board policy.

## Where the loader lives

The config-loader is Layer-1 (portable-core) scope, not a Claude-Code-only
enhancement: `targeting`/`destination`/`board` values must resolve
identically for any MCP host, matching
[ADR-0001](../decisions/adr-0001-bug-capture-layer1-core.md)'s core/enhancement
split. It ships as `plugins/github-sdlc-planning/mcp-server/src/config.ts`,
exported via the package's `./config` subpath — the same subpath-export
mechanism `github-pull-requests` already uses to reuse `mif.ts` (see
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

The one exception is `github-sdlc-planning`'s **hooks** layer
(`hooks/lib/in-progress.mjs`), which is deliberately dependency-free (no
`node_modules` available at hook-execution time — see
`github-bug-capture`'s `hooks/lib/settings.mjs`, which documents the same
constraint for its own plugin) and cannot import an npm-backed module. It
keeps its own minimal, dependency-free reader for the `board` section of
the new plain-YAML files, mirroring its existing hand-rolled `board:`
frontmatter parser rather than sharing code with the MCP-server loader.
Both readers are kept behaviorally identical on purpose (issue #83's
review caught and fixed a real divergence between them) — see *Verified
end-to-end* below.

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
  "import('.../mcp-server/dist/config.js').then(m => \
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
