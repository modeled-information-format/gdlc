---
id: 3f7c1a5e-6b9d-4f28-a4e6-8c1b5d3f7a92
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Find which issues a PR closes with get_linked_issues
diataxis_type: how-to
---

Discover which issues a pull request will close (or references), using
GitHub's native closing-reference tracking with a text/timeline fallback.

## Prerequisites

- `github-pull-requests` installed (this call also reuses
  `github-sdlc-planning`'s MIF-comment-block reader).
- Read access to the target repository and pull request.

## Steps

1. Call `get_linked_issues`:

   ```json
   { "owner": "your-org", "repo": "your-repo", "pullNumber": 12 }
   ```

2. Read the response:

   ```json
   {
     "items": [
       { "number": 42, "repo": "your-org/your-repo", "source": "closing_reference", "closing": true, "alreadyTracked": true }
     ],
     "sourceAttempted": ["closing_reference"]
   }
   ```

## Verify it worked

Check `sourceAttempted`: if it is `["closing_reference"]` only, GitHub's
GraphQL `closingIssuesReferences` field had results and that is what you're
seeing. If it is `["closing_reference", "heuristic"]`, GraphQL returned
nothing and the result instead comes from a Timeline API + PR body/commit
text scan — treat these `items` as lower confidence and check the `closing`
field per item rather than assuming every match is a true close.

## Notes

- `closingIssuesReferences` can lag briefly after a PR is opened or its body
  edited; if you expect a match and see an empty `closing_reference` result,
  retry after a short wait before concluding the PR doesn't close the issue.
- `alreadyTracked` is `true` when the target issue's body already carries a
  `github-sdlc-planning` MIF comment block (read via the shared parser) — use
  it to avoid re-creating a planning unit for an issue that already has one.
- The heuristic fallback recognizes both closing keywords (`closes`,
  `fixes`, `resolves`, with or without a colon) and bare `#N` references;
  only keyword matches set `closing: true`.
