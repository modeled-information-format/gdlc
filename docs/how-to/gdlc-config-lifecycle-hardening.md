---
id: c5c59537-2a11-402b-ac2e-3922dc65b610
type: procedural
created: 2026-07-12T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: '2026-07-12T13:50:00.372Z'
title: Keep gdlc's config schema-valid and in sync automatically
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

The [configure-gdlc agent](configure-gdlc.md) is a one-time authoring flow.
This page covers the two automated checks that keep an already-written
`.config/gdlc/config.yml` from silently drifting afterward (ADR-0009, Story
#264) — a CI gate over PR diffs, and a passive session-start hook.

## CI gate: schema validation on every PR

`.github/workflows/ci.yml`'s `gdlc-config-validate` job runs the same
validator `write_gdlc_config` uses (`GDLC_CONFIG_SECTION_SCHEMAS`), via the
already-built `plugins/github-sdlc-planning/mcp-server/dist/validate-gdlc-config.js`,
against every `.config/gdlc/config.yml` found in the repo tree. It fails the
PR if any file doesn't validate — including a hand-edited file that never
went through the agent at all.

This is the gate that would have caught issue #247/#248 (a `prLifecycle`
field the loader supported but the schema file didn't declare) before
merge, not just after a bug report.

Adopting this in a *different* repo: copy the job, point `validator` at
wherever your own build of `github-sdlc-planning`'s MCP server dist lives
(or vendor the single bundled file — it has no runtime dependencies once
built), and adjust the `find` scope if your config lives somewhere other
than `.config/gdlc/config.yml`.

## Session-start hook: passive drift detection

`hooks/config-drift-check.mjs` runs on every `SessionStart` alongside the
existing `session-start.mjs` (`hooks/hooks.json`). Two checks, both
non-blocking (silent when nothing is wrong, matching every other advisory
hook in this plugin):

1. **Schema validity** — re-validates the resolved config the same way the
   CI gate does. Catches a file that was valid when written but no longer
   matches the schema after it evolved.
2. **Board reachability** — a best-effort, 5-second-timeout `gh project
   view` check against the configured `board.projectOwnerLogin`/
   `projectNumber`. Only reports drift on a confirmed "not found"; an
   auth hiccup, network blip, or missing `gh` login is treated as
   inconclusive, never misreported as "the board was deleted."

Unlike the ticket-hygiene hook trio
([register-hygiene-hook-at-project-level.md](register-hygiene-hook-at-project-level.md)),
this hook is **not** copyable to a project that doesn't install
`github-sdlc-planning` — it imports the plugin's own built MCP-server dist
(`../mcp-server/dist/validate-gdlc-config.js`) by relative path, so it only
runs correctly from inside this plugin's own `hooks/` directory. If you want
equivalent drift detection in a repo that doesn't install this plugin,
invoke the CI gate's `validate-gdlc-config.js` script directly instead
(see above), or run `configure-gdlc` periodically by hand.

## Verify it's working

Write a schema-invalid `.config/gdlc/config.yml` (e.g. `board.projectNumber`
as a non-numeric string) and start a new session in that directory —
`hookSpecificOutput.additionalContext` should name the file and point at
the `configure-gdlc` skill. A schema-valid file with no board section, or
none at all, produces no output — the correct, non-noisy result.
