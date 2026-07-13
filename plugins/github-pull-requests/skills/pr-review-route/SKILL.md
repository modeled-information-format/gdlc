---
description: Suggest reviewers for a pull request from a CODEOWNERS-style heuristic and request them on confirmation. Use when the user asks to "route this PR for review", "who should review this", or "request reviewers".
when_to_use: Trigger on "who should review this PR", "route this for review", "request reviewers for #N", or right after opening a PR when the user asks for review routing.
argument-hint: "[owner/repo] [pr number]"
allowed-tools: Bash, Read, mcp__github-pull-requests__*, mcp__plugin_github-pull-requests_github-pull-requests__*
---

# PR review routing

Suggest and request reviewers for **$ARGUMENTS**.

1. Read the repository's `CODEOWNERS` file (`Read` or `gh api
   repos/<owner>/<repo>/contents/.github/CODEOWNERS`) if one exists.
2. List the PR's changed files (`gh pr diff --name-only` or the REST files
   endpoint) and match them against CODEOWNERS path patterns to build a
   candidate reviewer/team list. If there's no CODEOWNERS file, say so and
   ask the user who should review instead of guessing.
3. Present the candidate list and ask for confirmation before requesting
   anyone — reviewer routing is a suggestion, not an autonomous decision.
4. On confirmation, call `mcp__github-pull-requests__request_review` with the
   confirmed reviewers/teams.
5. If `request_review` reports `stale_target` (the PR closed or merged mid-call)
   or a team-access rejection, relay the exact error to the user rather than
   retrying silently — a closed PR or an inaccessible team needs a human
   decision, not a retry loop.
