---
id: 2277baf1-da5a-4181-9910-4eda732176f9
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Create an issue with the create_issue tool
diataxis_type: how-to
---


Goal: file a new GitHub issue whose body carries MIF frontmatter
automatically, optionally with labels, assignees, a milestone, and an
organization issue type.

## Prerequisites

- `github-sdlc-planning` installed and a GitHub token available (env var
  `GITHUB_TOKEN` or `gh auth login`).
- Write access to the target repository.
- If you pass `labels`, `assignees`, or `milestoneNumber`, those labels,
  users, and milestone must already exist — the tool resolves each to a
  node ID and fails if the lookup 404s.
- If you pass `issueType`, it must be one of the organization's defined
  issue types (`owner` is treated as the org login for this lookup).

## Steps

1. Decide the MIF metadata for the issue: a `namespace` (typically the repo
   name), an `id` slug unique within that namespace, and a `type` — one of
   `Initiative`, `Epic`, `Story`, `Task`, `Bug`, `Feature`.
2. Call `create_issue`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "title": "Fix flaky upload retry",
     "body": "Uploads intermittently fail on slow connections.",
     "labels": ["bug"],
     "mif": { "id": "flaky-upload-retry", "type": "Bug", "namespace": "your-repo" }
   }
   ```

3. Read the response: `{ number, nodeId, url, body }`.

## Verify it worked

- Open the returned `url`. The issue exists with the title and labels you
  specified.
- View the raw body (e.g. via the GitHub API or the "Edit" view) and confirm
  it starts with three HTML comments: `<!-- mif-id: ... -->`, `<!-- mif-type:
  ... -->`, `<!-- mif-ns: ... -->` — you never need to author these by hand.
- If `issueType` was rejected, the tool call errors before touching the API
  with `{ error: "unknown_issue_type", available: [...] }` listing the
  organization's actual issue type names.

See also: [tool reference](../reference/tools.md#create_issue).
