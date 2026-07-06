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
decided by ADR-0004 (staged in
[PR #97](https://github.com/modeled-information-format/gdlc/pull/97), not
yet merged as of this page's writing — linking to the PR rather than
`docs/decisions/adr-0004-project-config-surface.md` directly so this page
isn't a broken relative link if merged independently; issue
[#79](https://github.com/modeled-information-format/gdlc/issues/79)); this
page is the schema those two layers share (issues
[#80](https://github.com/modeled-information-format/gdlc/issues/80) and
[#81](https://github.com/modeled-information-format/gdlc/issues/81)).
Machine-readable copy: [`schema/gdlc-config.schema.json`](../../schema/gdlc-config.schema.json).

## Files and resolution

Both layers will be plain YAML, no frontmatter wrapper, same relative
suffix. The config-loader (issue #82, not yet implemented as of this page's
writing) is intended to compute the file path from a root with one
function, `resolveConfigPath(root) => path.join(root, 'gdlc', 'config.yml')`,
handing it a different root per layer:

| Layer | Root handed to `resolveConfigPath` | Resulting path |
| --- | --- | --- |
| Global | `$XDG_CONFIG_HOME` (env var, default `~/.config`) | `$XDG_CONFIG_HOME/gdlc/config.yml` |
| Project | `<projectRoot>/.config` | `<projectRoot>/.config/gdlc/config.yml` |

The project root itself is **not** meant to be handed to `resolveConfigPath`
directly — the loader should join on `.config` first, since
`$XDG_CONFIG_HOME` (the global root) already points at what `.config`
conceptually is for that layer; handing the bare project root would
resolve to `<projectRoot>/gdlc/config.yml`, missing the `.config/` segment
entirely. Neither file will be required to exist; a missing file is meant
to be an empty config at that layer, not an error.

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

The config-loader (issue #82, not yet implemented as of this page's
writing) is intended to try `.config/gdlc/config.yml`'s `board` section
first. If that section is absent, it should fall back for one release to
the legacy `board:` map in `.claude/github-sdlc-planning.local.md`
(`docs/how-to/plan-work-with-the-plugins.md` step 3), emitting one
deprecation notice on first use. `` `.claude/<plugin>.local.md` `` files
otherwise keep their original, narrower purpose: personal, uncommitted,
per-developer runtime toggles (e.g. github-bug-capture's `packs:` map),
never team-shared targeting/board policy.

## Where the loader will live

The config-loader is Layer-1 (portable-core) scope, not a Claude-Code-only
enhancement: `targeting`/`destination`/`board` values must resolve
identically for any MCP host, matching
[ADR-0001](../decisions/adr-0001-bug-capture-layer1-core.md)'s core/enhancement
split. It is intended to ship as
`plugins/github-sdlc-planning/mcp-server/src/config.ts` (issue #82, not yet
implemented as of this page's writing), exported via a new `./config`
subpath on that package — the same subpath-export mechanism already used
for `mif.ts`: `github-sdlc-planning/mcp-server/package.json` defines the
`exports` map, and `github-pull-requests` consumes it via a `file:`
dependency (see `plugins/github-pull-requests/mcp-server/package.json`).

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
