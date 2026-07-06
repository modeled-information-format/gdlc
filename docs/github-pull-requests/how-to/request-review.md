---
id: 4c8a2f6d-9e3b-4c75-a1d8-6f4b2e9c7a53
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Request reviewers on a PR with request_review
diataxis_type: how-to
---

Request one or more reviewers, and/or teams, on an open pull request.

## Prerequisites

- `github-pull-requests` installed.
- An **open** pull request — this tool checks PR state before requesting
  and rejects a closed or merged target.
- Write access to the repository, and (for team reviewers) the requested
  team must have access to the repository.

## Steps

1. Gather the usernames and/or team slugs to request.
2. Call `request_review`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "pullNumber": 12,
     "reviewers": ["alice", "bob"],
     "teamReviewers": ["platform-team"]
   }
   ```

   Both `reviewers` and `teamReviewers` are optional, but at least one
   should be supplied for the call to have any effect.
3. Read the response: `{ users: string[], teams: string[] }` — the reviewers
   and teams now requested.

## Verify it worked

Call `list_review_requests` with the same `owner`/`repo`/`pullNumber` and
confirm the names appear in `users`/`teams`.

## Notes

- If the PR is not open, the call fails with `stale_target` and reports
  whether the PR is merged or closed.
- If a requested team lacks access to the repository, GitHub's rejection
  surfaces verbatim as a `github_api_error` — it is not retried or
  pre-validated.
