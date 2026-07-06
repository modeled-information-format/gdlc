---
id: 2a6d9c3e-4b7f-4e12-9a8d-3c5e7b1f9a24
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Open a pull request with create_pull_request
diataxis_type: how-to
---
# Open a pull request with `create_pull_request`

Open a pull request programmatically via GitHub's GraphQL
`createPullRequest` mutation, without leaving your agent session.

## Prerequisites

- `github-pull-requests` installed.
- A head branch already pushed to the repository, with commits ahead of the
  base branch.
- Auth with write access to the target repository (`GITHUB_TOKEN` or `gh`
  CLI login).

## Steps

1. Identify the `owner`, `repo`, `baseRefName` (e.g. `main`), and
   `headRefName` (your pushed branch) for the PR.
2. Call `create_pull_request`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "title": "feat: add widget support",
     "body": "Fixes #12",
     "baseRefName": "main",
     "headRefName": "feat/widget-support",
     "draft": false
   }
   ```

   `body` and `draft` are optional. If you want the merge to close an issue,
   write `Fixes #N`/`Closes #N` into `body` yourself — the tool attaches no
   linkage or MIF frontmatter to the PR body on its own.
3. Read the response: `{ number, url, nodeId }`.

## Verify it worked

Open `url` from the response, or call `list_review_requests` with the
returned `number` as `pullNumber` — a 200 response with an empty or populated
reviewer list confirms the PR exists.

## Notes

- If a PR already exists for the same head ref, or `headRefName` does not
  exist, GitHub's GraphQL rejection surfaces verbatim as a
  `github_api_error` — there is no client-side pre-validation.
