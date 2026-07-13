---
description: Break a high-level goal into an Epic with Story/Task sub-issues using GitHub's native sub-issue hierarchy and MIF-conformant issue bodies. Use when the user asks to "break this down", "decompose this epic", "create sub-issues for", or "turn this into a work plan".
when_to_use: Trigger on "break this down into tasks", "decompose this epic", "create sub-issues", "turn this goal into issues", or when planning work that clearly spans multiple issues.
argument-hint: "[owner/repo] [goal description]"
allowed-tools: Bash, mcp__github-sdlc-planning__*, mcp__plugin_github-sdlc-planning_github-sdlc-planning__*, mcp__mif-docs__*
---

# Epic decomposition

Decompose **$ARGUMENTS** into a native GitHub sub-issue hierarchy.

1. Create the parent Epic issue with `create_issue`
   (`mif.type: Epic`), summarizing the overall goal.
2. For each Story/Task the goal decomposes into, create a child issue
   (`mif.type: Story` or `Task` as appropriate) and attach it with
   `add_sub_issue`. Respect the tool's own limit_exceeded rejection (100
   sub-issues per parent, 8 nesting levels) — if you hit it, stop and tell the
   user their decomposition needs a second-level Epic instead of a flatter
   dump under one parent.
3. If the decomposition implies a natural build order, note it in the parent
   Epic's body as an ordered list of sub-issue references — sub-issues
   themselves carry no ordering field, so sequence lives in prose.
4. Report the created hierarchy: parent Epic URL, and each child's number,
   title, and type.

Every issue you create here still goes through `create_issue`'s own MIF-body
prepending — you never hand-write the `<!-- mif-id -->` comment block
yourself.
