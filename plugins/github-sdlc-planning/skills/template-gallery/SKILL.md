---
description: List and instantiate curated GitHub Projects v2 templates (Sprint Board, OKR Roadmap, Bug-Triage Board, Feature Pipeline) from the template manifest catalog. Use when the user asks "what templates are available", "show me project templates", or names a template by conversational cue like "we do two-week sprints".
when_to_use: Trigger on "what project templates do you have", "show me the template gallery", "we do two-week sprints" (maps to Sprint Board), "we track OKRs" (maps to OKR Roadmap), or similar conversational cues naming a work style.
argument-hint: "[owner/repo] [template name, optional]"
allowed-tools: Bash, mcp__github-sdlc-planning__*, mcp__plugin_github-sdlc-planning_github-sdlc-planning__*, Read
---

# Template gallery

List or instantiate a project template for **$ARGUMENTS**.

1. Read `templates/manifest.yml` (bundled with this plugin) for the current
   catalog: archetype, source org template project (when one exists), field
   set, recommended views, and default automations.
2. If the user named a template or gave a conversational cue that maps to
   one (see the manifest's `cues` list per entry — e.g. "two-week sprints" →
   `sprint-board`), propose that match; otherwise list all entries with a
   one-line description each and ask which one.
3. On confirmation, hand off to `@github-sdlc-planning:project-setup` with the
   matched template name as the `template name` argument — instantiation
   itself (via `copyProjectV2`) is the agent's job, not this skill's.
4. If the manifest names a source org template project that no longer exists
   (a stale catalog entry), say so explicitly and fall back to the agent's
   blank-`createProjectV2` path rather than failing silently.
