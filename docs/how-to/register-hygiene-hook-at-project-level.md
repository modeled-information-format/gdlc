---
id: 6f1b2c3d-8a4e-4f9b-9c1a-2d5e6f7a8b9c
type: procedural
created: 2026-07-09T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-09T00:00:00Z
title: Register the ticket-hygiene hook at the project level
diataxis_type: how-to
---

ADR-0007's ticket-hygiene reminder ships two ways, and neither is a fallback
for the other (AD-6): inside a plugin's own `hooks/hooks.json`
(`github-sdlc-planning`, `github-pull-requests`, `github-bug-capture` all
carry a copy), or registered directly from a consuming project's own
`.claude/settings.json`. Hook sources merge additively across policy,
project, user, local, and every enabled plugin's own `hooks/hooks.json`, so
both can be active at once without conflict.

## When to use project-level registration instead of a plugin

- You want the reminder active in a repo that doesn't install any of the
  `github-sdlc-plugins` family, or that only installs a subset that doesn't
  cover the tools you actually use.
- You want the hook's behavior tied to your own project's release cadence,
  not a plugin's.
- You want to register the same matcher set against a *different* script
  (a fork, a repo-specific variant) without depending on any plugin's copy
  at all.

## Steps

1. Copy the three canonical files from `github-sdlc-planning`'s
   `hooks/lib/` (`hygiene-check.mjs`, `hygiene-scratch.mjs`,
   `hygiene-aggregate.mjs`) and its two entrypoints
   (`hooks/hygiene-check.mjs`, `hooks/hygiene-aggregate.mjs`) into your
   project, e.g. under `.claude/hooks/`.
2. Add the equivalent matcher set to your project's `.claude/settings.json`:

   ```json
   {
     "hooks": {
       "PostToolUse": [
         {
           "matcher": "mcp__github__.*",
           "hooks": [
             { "type": "command", "command": "node", "args": [".claude/hooks/hygiene-check.mjs"], "timeout": 15 }
           ]
         },
         {
           "matcher": "Bash",
           "hooks": [
             { "type": "command", "command": "node", "args": [".claude/hooks/hygiene-check.mjs"], "timeout": 15 }
           ]
         }
       ],
       "Stop": [
         { "hooks": [{ "type": "command", "command": "node", "args": [".claude/hooks/hygiene-aggregate.mjs"], "timeout": 15 }] }
       ],
       "SubagentStop": [
         { "hooks": [{ "type": "command", "command": "node", "args": [".claude/hooks/hygiene-aggregate.mjs"], "timeout": 15 }] }
       ]
     }
   }
   ```

   Add a matcher scoped to any plugin-specific MCP tools you use in that
   project too (`mcp__<plugin>__.*`), the same way each of the three
   sibling plugin copies does for their own tools.

3. Nothing else to configure: every check inside `hygiene-check.mjs`
   already fails open (a missing `gh` auth, no tracked project, an
   unreadable transcript) rather than erroring, so there's no separate
   enable/disable toggle to wire up.

## Verify it's working

Touch a tracked issue through any of the three surfaces (a `gh issue`
command, the generic `github` MCP server, or a plugin's own tool) and
confirm `hookSpecificOutput.additionalContext` appears in the tool result
when a real gap exists (e.g. an Epic with no sub-issues yet). No output at
all is the expected, correct result when there's nothing to flag — this
hook never speaks up "just to confirm everything is fine."

## If you also install one of the plugins

Both registrations run: the plugin's own copy fires for its scoped tool
names, and your project-level copy fires for whatever you registered it
against. This is expected and harmless (AD-6) — worst case is a duplicate
reminder for the same touch, never a conflicting one, since both copies
run byte-identical detection logic.
