---
description: Set up a GitHub Projects v2 board from a high-level planning intent (board type, team size, sprint duration, target repo) via the project-setup agent's six-stage pipeline. Use when the user asks to "set up a project board", "create a sprint planning board", "configure a project for this team", or "bootstrap planning for" a repo.
when_to_use: Trigger on "set up a project board", "create a sprint board", "configure a project", "bootstrap a project for [team]", or a submitted project-setup-request.yml issue form.
argument-hint: "[owner/repo] [intent]"
allowed-tools: Bash, mcp__github-sdlc-planning__*, mcp__mif-docs__*
---

# Project setup

Set up a GitHub Projects v2 board for **$ARGUMENTS**.

1. Confirm auth: call `mcp__github-sdlc-planning__get_agent_capabilities`.
   If a later write fails with `missing_scope`, stop and tell the user to run
   `gh auth login --scopes project` — do not retry the same call blindly.
2. Hand off to the `project-setup` agent (`@github-sdlc-planning:project-setup`)
   with the target `owner/repo`, the parsed intent, and any of team size /
   sprint duration / template name the user already gave you. If the intent
   came from a submitted `project-setup-request.yml` issue, read it with
   `gh issue view <n> --json body` and pass the rendered key/value pairs
   through instead of re-parsing free text.
3. Relay the agent's six-stage report back to the user verbatim — project URL,
   created fields, automation status, and any human-follow-up steps it named
   (view layout, workflow toggles it couldn't reach programmatically).

Never skip stage 1's auth check to save a turn — a mid-pipeline `missing_scope`
failure after several successful writes is a worse experience than confirming
up front.
