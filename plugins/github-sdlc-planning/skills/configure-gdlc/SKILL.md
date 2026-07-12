---
description: Elicit and write gdlc's layered .config/gdlc/config.yml (targeting/destination/board/packs/prLifecycle) through the configure-gdlc agent's six-stage confirm-before-write pipeline, instead of hand-authoring YAML against the schema docs. Use when the user asks to configure gdlc for a project, set up the board mapping, enable enhancement packs, or otherwise author gdlc's project or global config.
when_to_use: Trigger on "configure gdlc", "set up gdlc config", "elicit config", "configure this project for gdlc", "enable the hooks pack", or "set the board mapping for this repo".
argument-hint: "[owner/repo or directory] [what to configure]"
allowed-tools: Bash, AskUserQuestion, mcp__github-sdlc-planning__*
---

# Configure gdlc

Configure gdlc's layered config for **$ARGUMENTS**.

1. Confirm which directory/repo is being configured — don't assume the
   running session's cwd is the intended target if the intent names a
   different repo.
2. Hand off to the `configure-gdlc` agent (`@github-sdlc-planning:configure-gdlc`)
   with the confirmed target directory and whatever the user already said
   about which section(s) they want to touch (board mapping, packs,
   targeting, destination, prLifecycle).
3. Relay the agent's six-stage report back to the user verbatim — current
   state shown, write target confirmed, sections elicited, preview shown,
   write confirmed, final report of what changed and what didn't.

Never let the agent skip stage 2 (explicit write-target elicitation) or
stage 4 (preview via `dryRun`) to save a turn — per ADR-0009, a config
write is never inferred and never applied without the user seeing the
actual resulting bytes first.
