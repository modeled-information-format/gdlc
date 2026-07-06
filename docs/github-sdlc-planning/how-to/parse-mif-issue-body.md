---
id: b8ce2184-819a-493f-a9c5-07d8bcded67a
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Parse a MIF issue body with parse_mif_issue_body
diataxis_type: how-to
---

# Parse a MIF issue body with `parse_mif_issue_body`

Goal: read an issue or discussion body's raw text and extract its MIF
metadata (`id`, `type`, `namespace`) plus the body with the frontmatter
comments stripped out.

## Prerequisites

- None — this is a pure string-transformation function; it makes no GitHub
  API call. It works on any raw body text, whether or not it actually
  carries MIF frontmatter.

## Steps

1. Call `parse_mif_issue_body` with the raw body text (for example, fetched
   separately via `gh issue view <number> --json body -q .body`, a direct
   GitHub API read, or a body you already have in hand from a prior
   `create_issue` call, which returns the body it created — `update_issue`
   returns only `{ number, url }`, not the body):

   ```json
   {
     "raw": "<!-- mif-id: urn:mif:concept:your-repo:flaky-upload-retry -->\n<!-- mif-type: Bug -->\n<!-- mif-ns: your-repo -->\nUploads intermittently fail on slow connections."
   }
   ```

2. Read the result:

   ```json
   {
     "meta": { "id": "flaky-upload-retry", "type": "Bug", "namespace": "your-repo" },
     "body": "Uploads intermittently fail on slow connections."
   }
   ```

## Verify it worked

- `meta.id` is the slug portion only (not the full `urn:mif:concept:...`
  string).
- If the raw text is missing any one of the three comment lines, `meta` is
  `null` and `body` is returned unchanged (the whole input, untouched) —
  this is how you detect a non-MIF-conformant body, not an error.

See also: [tool reference](../reference/tools.md#parse_mif_issue_body).
