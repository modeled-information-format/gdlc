# Pack toggles — the enhancement-pack control plane

The research blueprint requires "zero-core-change extensibility": enabling or
disabling an AI-enhancement pack must be one configuration change, never a
core-code change. This marketplace installs plugins whole (there is no
per-pack `enabledPlugins` granularity), so the control plane lives one level
down, in the plugin-settings pattern: a per-project settings file that every
pack checks before acting.

## The settings file

`.claude/github-bug-capture.local.md` in the consuming project (gitignored —
it is per-project, per-user state):

```markdown
---
packs:
  hooks: false
  triage-skills: false
  mcp-integration: false
  gh-aw: false
---

Notes for humans go here; only the frontmatter is machine-read.
```

## Semantics

- **Default off, fail closed.** A missing file, a missing `packs:` map, a
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

## Why frontmatter-in-markdown

It is the documented Claude Code plugin-settings convention
(`.claude/<plugin-name>.local.md`): human-readable notes below the
frontmatter, machine-read keys above, no new file format, no runtime
dependency — the reader is dependency-free line parsing over a deliberately
constrained schema (`packs:` map of `key: true|false`).
