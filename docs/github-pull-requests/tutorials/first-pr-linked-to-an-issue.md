---
id: 9d4c7a2e-6f3b-4d81-a2e7-8b5f1c9d3a67
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Open your first PR and link it to an issue
diataxis_type: tutorial
---

This tutorial walks through opening a pull request, classifying it, routing a
reviewer, and confirming it closes an issue on merge — using only
`github-pull-requests` tools. By the end you will have driven one PR through
its full lifecycle with this plugin.

## Before you start

- `github-pull-requests` installed (`/plugin install
  github-pull-requests@github-sdlc-plugins`); this pulls in
  `github-sdlc-planning` automatically.
- A repository you can push a branch to, with an existing open issue to
  close (any issue number works — call it `#42` for this walkthrough).
- A branch already pushed with the fix, e.g. `fix/42-something`, based on
  `main`.

Substitute your own `owner`, `repo`, branch names, and issue number
throughout.

## 1. Open the pull request

Ask your agent to call `create_pull_request`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "title": "fix: something",
  "body": "Fixes #42",
  "baseRefName": "main",
  "headRefName": "fix/42-something"
}
```

Writing `Fixes #42` in `body` is what makes the merge close the issue later —
`create_pull_request` does not add any linkage on its own. The response
returns `{ number, url, nodeId }`. Note the `number`; every following call
uses it as `pullNumber`.

## 2. Classify it

Call `classify_pull_request`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "pullNumber": <the number from step 1>,
  "type": "fix"
}
```

This computes a size label from the diff (`XS` through `XL`) and applies
`type:fix` plus `size:*` labels to the PR. Check the response's
`labelsApplied` to confirm both landed.

## 3. Request a reviewer

Call `request_review`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "pullNumber": <the number from step 1>,
  "reviewers": ["a-teammate-username"]
}
```

The response echoes back `{ users, teams }`. Call `list_review_requests`
with the same `owner`/`repo`/`pullNumber` (no reviewer fields) to confirm the
request is visible on the PR.

## 4. Verify the linkage before merge

Call `get_linked_issues`:

```json
{ "owner": "your-org", "repo": "your-repo", "pullNumber": <the number from step 1> }
```

Because you wrote `Fixes #42` in the body, GitHub's
`closingIssuesReferences` should already list issue `42` with
`source: "closing_reference"` and `closing: true`. If it instead falls back
to `source: "heuristic"`, GitHub has not yet indexed the reference — this is
expected to lag briefly after opening a PR; re-run the call after a short
wait.

## 5. Merge, then confirm the issue closed

Merge the PR through your normal process (this plugin does not expose a
merge tool). Once merged, GitHub closes issue `#42` automatically because of
the `Fixes #42` text — nothing further to call for that part.

## 6. Reflect the merge on a board field (optional)

If the PR is on a Projects v2 board and you want a field (e.g. a "Shipped
in" iteration) stamped on every issue it closed, call
`sync_linked_issues_project_field`:

```json
{
  "owner": "your-org",
  "repo": "your-repo",
  "pullNumber": <the number from step 1>,
  "projectOwnerLogin": "your-org",
  "projectNumber": 1,
  "fieldId": "<field node id>",
  "value": { "kind": "text", "text": "2026-Q3" }
}
```

This call requires the PR to already be merged — it fails with `not_merged`
otherwise. Check `synced` in the response to confirm issue `42` was updated.

## What you did

You opened a PR, classified it, requested a review, confirmed its issue
linkage, and (optionally) propagated the merge onto a board field — the same
sequence `sync_linked_issues_project_field`'s own docstring describes as the
plugin's PR-merge → issue-close leg. Each step used exactly one tool call
with the PR's `owner`/`repo`/`pullNumber` triple, which every tool in this
plugin takes as its base reference.
