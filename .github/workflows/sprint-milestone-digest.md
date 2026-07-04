---
on:
  schedule: weekly on monday around 9:00
  workflow_dispatch:

permissions:
  contents: read
  issues: read

engine:
  id: copilot
  model: claude-sonnet-5

pre-steps:
  - name: Mint the "issues" App installation token
    id: issues_token
    uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
    with:
      client-id: ${{ vars.ISSUES_CLIENT_APP_ID }}
      private-key: ${{ secrets.ISSUES_CLIENT_APP_PRIVATE_KEY }}
      owner: modeled-information-format
      repositories: gdlc

tools:
  github:
    toolsets: [context, issues]

mcp-servers:
  github-sdlc-planning:
    container: ghcr.io/modeled-information-format/gdlc-planning-mcp:latest
    env:
      GITHUB_TOKEN: ${{ steps.issues_token.outputs.token }}
    allowed: [list_milestones, get_session_context]

safe-outputs:
  create-issue:
    max: 1
---

# Sprint/Milestone Digest

Check every open milestone in this repository for staleness, and post exactly
one summary issue if anything is worth flagging. If nothing is worth
flagging, do nothing — no issue, no noise.

## Instructions

1. Call `list_milestones` (from the `github-sdlc-planning` MCP server) for
   this repository, open milestones only.
2. For each open milestone, use the built-in GitHub tools to list its open
   issues and each issue's `updated_at` timestamp.
3. Flag a milestone when either is true:
   - Its due date is within 3 days (or already past) and it still has one or
     more open issues.
   - Any of its open issues has not been updated in 14 or more days.
4. If one or more milestones are flagged, create exactly one issue
   summarizing the findings, grouped by milestone: milestone title, due
   date, and the specific issues that triggered the flag (with a one-line
   reason each: "due in N days, M open issues" or "no activity in N days").
   Title the issue `Sprint/milestone digest: <date>`.
5. If no milestone is flagged, do not create an issue. A quiet run is a
   successful run.

Do not modify any issue or milestone — this workflow only reads and reports.
