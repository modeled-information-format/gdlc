---
description: Plan a sprint from the open backlog, team size, and cadence — select candidate issues, assign the Sprint iteration field, and set Story Points. Use when the user asks to "plan the next sprint", "fill sprint N", or "what should we work on this sprint".
when_to_use: Trigger on "plan the next sprint", "fill out sprint N", "what goes in this sprint", or when a sprint-planning-request.yml issue form is submitted.
argument-hint: "[owner/repo] [project number] [sprint iteration]"
allowed-tools: Bash, mcp__github-sdlc-planning__*, mcp__plugin_github-sdlc-planning_github-sdlc-planning__*, mcp__mif-docs__*
---

# Sprint plan

Plan a sprint for **$ARGUMENTS**.

1. Read the current board state with `get_project_items` and the open
   milestones with `list_milestones` to see what's already tracked.
2. Propose a candidate set of issues for the sprint from the open backlog,
   sized to the stated team capacity (team size × cadence, weighted by any
   existing Story Points values) — present this as a plan before writing
   anything, since sprint selection is a judgment call the user should
   confirm, not a fact you compute.
3. On confirmation, for each selected item call `set_field_value` to set the
   `Sprint` iteration field, and `Story Points` if not already set.
4. If a submitted `sprint-planning-request.yml` form supplied the team size
   and cadence, read it via `gh issue view <n> --json body` instead of asking
   the user again.
5. Report the finalized sprint roster: item, current Status, Story Points,
   and total committed points against stated capacity.

Never silently commit to a sprint composition without the confirmation step in
3 — an AI-suggested board layout is guidance, not an autonomous decision.
