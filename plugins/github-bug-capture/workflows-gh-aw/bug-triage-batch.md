---
on:
  workflow_dispatch:
  schedule: weekly on monday around 9:00

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

safe-outputs:
  add-labels:
    max: 20
  add-comment:
    max: 20
---

# Bug Triage Batch (technical preview)

Batch-triage every open issue labeled `bug` in this repository: flag likely
duplicates and suggest a `severity:*` label, without ever mutating anything
beyond adding a label or a comment.

This is a template/example for the gh-aw pack (issue #42), not a
production-critical workflow — see [`README.md`](README.md) for why it ships
disabled and out of this repo's own `.github/workflows/`.

## Instructions

1. List open issues labeled `bug` in this repository, using the built-in
   GitHub tools (`toolsets: [context, issues]`). This deliberately does not
   call the `github-bug-capture` MCP server's own tools: that server has no
   published container image yet, so this template uses only the built-in
   GitHub issue-search/list tools already proven by this repo's other gh-aw
   workflows.

2. For each open `bug` issue, search for likely duplicates: other issues
   (open or closed) whose titles share the most distinctive keywords with
   this one. This mirrors the `dedup-check` skill's plain-keyword approach
   (not AI/embedding similarity) — treat matches as leads, not verdicts.

3. For each open `bug` issue that does not already carry a `severity:*`
   label, suggest one (Critical/High/Medium/Low) from its title and body
   using the same heuristic the `triage` skill documents: data
   loss/security/crash-with-no-workaround -> Critical; broken build or a
   blocking regression -> High; a functional bug with a workaround ->
   Medium; cosmetic/non-blocking -> Low.

4. For each issue where you found either a likely duplicate or a severity
   suggestion, add exactly one comment naming what you found (duplicate
   candidates as `#N` links, or the suggested severity and why). When you
   are confident in the suggested severity (the title/body clearly matches
   one of the four categories with no real ambiguity), also add the matching
   `severity:<critical|high|medium|low>` label — never remove or replace an
   existing `severity:*` label; if the issue already has one, only comment
   with your assessment. If you found nothing worth flagging for an issue,
   leave it alone; a quiet run for that issue is correct.

5. Never close, reopen, or edit the body of any issue. Never remove a label.
   This workflow only reads issues and adds labels/comments through the
   declared `safe-outputs`.
