---
id: 0f43d7b8-676a-4628-941f-d47f3955db2f
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Attach a sub-issue with the add_sub_issue tool
diataxis_type: how-to
---


Goal: attach an existing child issue to an existing parent issue using
GitHub's native sub-issue relationship.

## Prerequisites

- Both the parent and the child issue already exist.
- The parent has fewer than 100 existing sub-issues.
- Attaching the child would not place the resulting hierarchy at or past 8
  nesting levels (the tool computes the parent's current level by walking
  its own parent chain before deciding).
- The child may live in a different repository within the same
  organization — pass `childOwner`/`childRepo` if so.

## Steps

1. Call `add_sub_issue`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "parentNumber": 101,
     "childNumber": 102
   }
   ```

2. If the child is in a different repo:

   ```json
   {
     "owner": "your-org",
     "repo": "parent-repo",
     "parentNumber": 101,
     "childOwner": "your-org",
     "childRepo": "child-repo",
     "childNumber": 7
   }
   ```

3. On a concurrent re-parent (the child already has a different parent),
   the default `replaceParent: true` lets the call succeed by reassigning
   it. Pass `replaceParent: false` if you want it to fail instead when the
   child is already parented elsewhere.

## Verify it worked

- Read the response: `{ parentNodeId, childNodeId, replacedParent }`.
- Reload the parent issue on GitHub — the native "Sub-issues" panel lists
  the child.
- Call [`list_sub_issues`](list-sub-issues.md) against the parent and
  confirm the child appears in `items`.
- If the parent was already at the sub-issue or nesting limit, the call
  fails before reaching GitHub with `{ error: "limit_exceeded", limit:
  "max_sub_issues_per_parent" | "max_nesting_levels", ... }`.

See also: [tool reference](../reference/tools.md#add_sub_issue).
