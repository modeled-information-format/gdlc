---
id: 0a31c133-9412-4e0d-96e2-0cc2f0ad003a
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List milestones with list_milestones
diataxis_type: how-to
---

# List milestones with `list_milestones`

Goal: retrieve a repository's milestones, filtered by state.

## Prerequisites

- Read access to the target repository.

## Steps

1. Call `list_milestones`:

   ```json
   { "owner": "your-org", "repo": "your-repo", "state": "open" }
   ```

   Omit `state` to default to `open`; pass `"closed"` or `"all"` for other
   views.

2. Read the response — an array of `{ number, title, url, dueOn }`.

## Verify it worked

- Cross-check the returned titles/numbers against the repository's
  Milestones page in the browser, filtered the same way.
- An empty array is a valid result (no milestones match the requested
  state) — it's not an error condition.

See also: [tool reference](../reference/tools.md#list_milestones).
