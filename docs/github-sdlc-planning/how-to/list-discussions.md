---
id: ac855f9d-79cd-4660-9795-204fff88212a
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List discussions with list_discussions
diataxis_type: how-to
---


Goal: retrieve a repository's Discussions (up to the first 50).

## Prerequisites

- Read access to the target repository.

## Steps

1. Call `list_discussions`:

   ```json
   { "owner": "your-org", "repo": "your-repo" }
   ```

2. Read the response — an array of `{ id, number, title, url, category }`.

## Verify it worked

- Cross-check titles/numbers against the repository's Discussions tab.
- Note the tool returns only the first 50 discussions; for a repository
  with more, you'll need pagination not currently exposed by this tool.

See also: [tool reference](../reference/tools.md#list_discussions).
