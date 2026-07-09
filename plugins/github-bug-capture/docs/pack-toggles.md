# Pack toggles — the enhancement-pack control plane

The research blueprint requires "zero-core-change extensibility": enabling or
disabling an AI-enhancement pack must be one configuration change, never a
core-code change. This marketplace installs plugins whole (there is no
per-pack `enabledPlugins` granularity), so the control plane lives one level
down, in the shared `.config/gdlc/config.yml` layered config every pack
checks before acting.

## The config file

`.config/gdlc/config.yml` (project layer, committed) or
`$XDG_CONFIG_HOME/gdlc/config.yml` (global layer), same cascade as
`targeting`/`destination`/`board` — see
[the config schema reference](../../../docs/reference/config-schema.md).
Originally this lived in a personal, uncommitted `.claude/github-bug-capture.local.md`
frontmatter file; [ADR-0006](../../../docs/decisions/adr-0006-eliminate-markdown-config-carriers.md)
moved it here explicitly, accepting the trade-off that pack toggles are now
committed, team-shared policy rather than a personal per-developer setting:

```yaml
packs:
  hooks: false
  triage-skills: false
  mcp-integration: false
  gh-aw: false
```

## Semantics

- **Default off, fail closed.** A missing file, a missing `packs:` section, a
  missing key, or an unparseable value all mean *disabled*. The Layer 1 core
  never consults this file — it is always on.
- **Boolean values only.** `true` enables a pack; anything else disables it.
- **One key per pack:**

| Key | Pack | Effect when `true` |
| --- | --- | --- |
| `hooks` | hooks-pack | PostToolUse (Bash) and Stop hooks scan for failure signatures and inject informational context pointing at file-bug; they never file an issue themselves. |
| `triage-skills` | triage-skill-pack | `file-bug`, `triage`, `dedup-check` skills act; otherwise they explain how to enable. |
| `mcp-integration` | mcp-integration-pack | The bundled GitHub-MCP wiring is treated as active documentation. |
| `gh-aw` | gh-aw-pack | gh-aw batch workflows may be installed/compiled. Technical preview — read the pack docs first. |

- **Read at use time, not load time.** Hooks and skills read the file on each
  invocation (`hooks/lib/settings.mjs`), so toggling takes effect without a
  plugin reload.
- **Project layer wholly overrides global**, same as every other section in
  this config: a `packs:` section present at the project layer replaces the
  global one entirely rather than merging key-by-key.

## Why `.config/gdlc/config.yml`

Consistent with [ADR-0004](../../../docs/decisions/adr-0004-project-config-surface.md)'s
structured-text-only, path-unified carrier, extended by
[ADR-0006](../../../docs/decisions/adr-0006-eliminate-markdown-config-carriers.md)
to also cover pack toggles: one plain-YAML file, no frontmatter wrapper, the
same relative path suffix under both the project root and
`$XDG_CONFIG_HOME`. `hooks/lib/settings.mjs`'s reader stays dependency-free
(no `node_modules` at hook-execution time), mirroring the parsing/resolution
pattern `github-sdlc-planning`'s `hooks/lib/in-progress.mjs` already proved
out for its `board:` section.
