---
id: f8e5f781-a4ab-4442-9bbe-4281ff743f0d
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Create a discussion with create_discussion
diataxis_type: how-to
---

# Create a discussion with `create_discussion`

Goal: create a new GitHub Discussion in a repository under a named category.

## Prerequisites

- The repository has Discussions enabled.
- You know the exact name of an existing discussion category (case-
  sensitive match against the repository's configured categories).

## Steps

1. Call `create_discussion`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "categoryName": "Ideas",
     "title": "Should we support multi-repo boards natively?",
     "body": "Opening this to gather feedback before filing an ADR."
   }
   ```

2. Read the response: `{ id, number, title, url }`.

## Verify it worked

- Open the returned `url` and confirm the discussion exists under the
  category you named.
- If `categoryName` doesn't match any category on the repository, the call
  fails before mutating with `{ error: "github_api_error", message:
  'Discussion category "..." not found in owner/repo', available: [...]
  }` — the `available` list names the repository's actual categories, so
  you can retry with a corrected name.

See also: [tool reference](../reference/tools.md#create_discussion).
