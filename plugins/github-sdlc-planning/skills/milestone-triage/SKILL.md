---
description: Review open milestones for a repo, flag ones that are overdue, empty, or over/under capacity, and suggest re-sequencing. Use when the user asks to "triage milestones", "review our milestones", or "clean up the milestone list".
when_to_use: Trigger on "triage milestones", "review our milestones", "clean up milestones", or "what's overdue".
argument-hint: "[owner/repo]"
allowed-tools: Bash, mcp__github-sdlc-planning__*
---

# Milestone triage

Review the open milestones for **$ARGUMENTS**.

1. List open milestones with `list_milestones`.
2. For each, flag:
   - **Overdue**: due date in the past, still open.
   - **Empty**: no issues assigned (cross-reference via
     `get_project_items`/issue search, since `list_milestones` alone doesn't
     carry issue counts).
   - **Stale**: no open issues updated recently, suggesting the milestone
     has stalled.
3. Present findings as a table (milestone, due date, flag, suggested action)
   and propose specific `assign_milestone` moves for issues that belong on a
   different (or no) milestone — but don't call `assign_milestone` without
   the user confirming each move, since re-sequencing changes what a team
   commits to.
4. If the user confirms, apply the moves and report the updated milestone
   state.
