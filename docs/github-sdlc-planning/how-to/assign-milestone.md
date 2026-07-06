---
id: c20707b3-9a4d-43dc-8ec6-e0e49ea8c032
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Assign or unassign a milestone with assign_milestone
diataxis_type: how-to
---

# Assign or unassign a milestone with `assign_milestone`

Goal: attach an issue to a milestone, or remove its milestone.

## Prerequisites

- Both the issue and (if assigning) the milestone already exist.

## Steps

1. To assign:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "issueNumber": 101,
     "milestoneNumber": 3
   }
   ```

2. To unassign, pass `null` for `milestoneNumber`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "issueNumber": 101,
     "milestoneNumber": null
   }
   ```

3. Read the response: `{ issueNumber, milestoneNumber }` (echoing what you
   set, including `null` on unassign).

## Verify it worked

- Reload the issue and confirm the milestone shown in the sidebar matches
  (or is cleared, for an unassign).

See also: [tool reference](../reference/tools.md#assign_milestone).
