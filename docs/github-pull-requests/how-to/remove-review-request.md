---
id: 6d2a9f4c-8b1e-4d67-a3c9-5e8b2f4d9c76
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Withdraw a review request with remove_review_request
diataxis_type: how-to
---

Remove one or more requested reviewers, and/or teams, from a pull request.

## Prerequisites

- `github-pull-requests` installed.
- Write access to the repository.
- Know exactly which reviewers/teams you want removed — call
  `list_review_requests` first if unsure.

## Steps

1. Call `remove_review_request`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "pullNumber": 12,
     "reviewers": ["alice"],
     "teamReviewers": ["platform-team"]
   }
   ```

   Both `reviewers` and `teamReviewers` are optional.
2. Read the response: `{ users: string[], teams: string[] }` — the
   reviewers/teams still requested after the removal.

## Verify it worked

Call `list_review_requests` and confirm the removed names no longer appear.

## Notes

- Unlike `request_review`, this call does not check PR state first — it can
  be called against a closed or merged PR without a `stale_target` error.
