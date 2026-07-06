---
id: d4fa9f5a-656d-43e2-8439-3cbd2e099b10
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Create a milestone with create_milestone
diataxis_type: how-to
---


Goal: create a new milestone on a repository.

## Prerequisites

- Write access to the target repository. Milestones are REST-only — GraphQL
  exposes them read-only, so this tool always goes through the REST
  milestones endpoint.

## Steps

1. Call `create_milestone`, supplying only the fields you need:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "title": "Q3 onboarding revamp",
     "description": "All onboarding-revamp work.",
     "dueOn": "2026-09-30T00:00:00Z"
   }
   ```

2. Read the response: `{ number, title, url, dueOn }`.

## Verify it worked

- Open the returned `url` and confirm the milestone exists with the title,
  description, and due date you specified.
- Call [`list_milestones`](list-milestones.md) and confirm it appears.

See also: [tool reference](../reference/tools.md#create_milestone).
