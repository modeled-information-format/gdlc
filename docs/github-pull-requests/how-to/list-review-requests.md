---
id: 8b3e6c9a-1d5f-4b82-9c4e-7a2d8f6b3e19
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Read current review requests with list_review_requests
diataxis_type: how-to
---
# Read current review requests with `list_review_requests`

Check which reviewers and teams currently have an outstanding review request
on a pull request.

## Prerequisites

- `github-pull-requests` installed.
- Read access to the target repository and pull request.

## Steps

1. Call `list_review_requests`:

   ```json
   { "owner": "your-org", "repo": "your-repo", "pullNumber": 12 }
   ```

2. Read the response: `{ users: string[], teams: string[] }`.

## Verify it worked

An empty `{ users: [], teams: [] }` means no reviewers are currently
requested (either none were ever requested, or all have already submitted a
review — GitHub clears a request once that reviewer responds). A non-empty
list means those reviewers/teams still have an open request.

## Notes

- This is a read-only call; it does not require write access to the
  repository, only read access.
- Use this before calling `remove_review_request` to confirm exactly who is
  currently requested, since removing a reviewer who was never requested is
  a silent no-op rather than an error.
