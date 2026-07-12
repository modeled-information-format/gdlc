---
id: dc22e19c-2ed4-4318-a586-720e4d0db757
type: procedural
created: 2026-07-12T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-12T13:43:13.718Z'
title: Configure gdlc's layered config with the configure-gdlc agent
diataxis_type: how-to
provenance:
  '@type': Provenance
  agent: claude-code/claude-sonnet-5
  wasGeneratedBy:
    '@id': urn:mif:activity:claude-code-session:6587ad77-f582-49d4-9e1b-44734dc4b70a
    '@type': prov:Activity
  trustLevel: user_stated
  agentVersion: 2.1.207
---

Author `.config/gdlc/config.yml` (project layer) or
`$XDG_CONFIG_HOME/gdlc/config.yml` (global layer) through a guided,
confirm-before-write conversation instead of hand-writing YAML against
[the schema reference](../reference/config-schema.md). Assumes Claude Code
with `github-sdlc-planning` installed (root [README](../../README.md#quick-start)).

Ask for the **configure-gdlc** skill (or invoke the `configure-gdlc` agent
directly) with what you want to configure — a board mapping, an enhancement
pack toggle, a targeting allowlist, a destination repo, or PR-lifecycle
enforcement. Under the hood it composes `get_gdlc_config` and
`write_gdlc_config` (both new in [ADR-0009](../decisions/adr-0009-configure-gdlc-agent-contract.md));
use those tools directly for a one-off scripted read/write.

## What the agent actually does

1. **Shows current state.** Calls `get_gdlc_config`, which returns the fully
   resolved merged config plus a diagnostics array naming every layer path
   checked, whether each exists, and which top-level sections each one
   contributes. This is how you find out, for example, that `board:` comes
   from a global file while `packs:` comes from a project-layer file three
   directories up.
2. **Asks which file to write, explicitly.** Per ADR-0009, a write never
   infers its target from the ancestor-search results shown in step 1 — you
   choose: edit an already-found ancestor file, create a new project-local
   file at the current directory, or write the global layer.
3. **Asks for each section's values**, offering the current resolved value
   as a "keep as-is" default so you're never forced to re-specify something
   you don't want to change.
4. **Previews the write.** Calls `write_gdlc_config` with `dryRun: true` and
   shows you the actual resulting file content — not a description of the
   change.
5. **Writes only after you confirm**, then reports the file path, the
   section(s) that changed, and what was left untouched.

## Why the write preserves formatting

`write_gdlc_config` mutates the target file via the `yaml` package's
`Document.set()` API rather than parsing to a plain object and
re-serializing — a section you didn't touch keeps its original comments,
key ordering, and quoting untouched, so a one-section config change still
produces a one-section PR diff.

## Hand-editing is still supported

Nothing about this agent is required — the file is still plain YAML you can
edit directly per [the schema reference](../reference/config-schema.md). The
agent exists to reduce the chance of a malformed or incomplete file (missing
a section a plugin actually needs, or an accidental edit to the wrong
layer's file), not to replace hand-editing as a valid path.
