---
id: 8177aaea-df62-499f-9679-69d161596a44
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List a parent's sub-issues with the list_sub_issues tool
diataxis_type: how-to
---

# List a parent's sub-issues with `list_sub_issues`

Goal: see a parent issue's sub-issues and how much of its work is complete.

## Prerequisites

- The parent issue exists (it may have zero sub-issues — the tool still
  returns a valid, empty-total result).

## Steps

1. Call `list_sub_issues`:

   ```json
   { "owner": "your-org", "repo": "your-repo", "parentNumber": 101 }
   ```

2. Read the response:

   ```json
   {
     "total": 2,
     "completed": 1,
     "percentCompleted": 50,
     "items": [
       { "number": 102, "nodeId": "...", "title": "Redesign the welcome email", "state": "CLOSED" },
       { "number": 103, "nodeId": "...", "title": "Add a product tour", "state": "OPEN" }
     ]
   }
   ```

## Verify it worked

- `total`/`completed`/`percentCompleted` come from GitHub's own
  `subIssuesSummary`, so they match what the parent issue's UI panel shows.
- Close or reopen a listed sub-issue on GitHub, call the tool again, and
  confirm `completed`/`percentCompleted` update — this is GitHub-computed
  state, not anything this plugin tracks separately.

See also: [tool reference](../reference/tools.md#list_sub_issues).
