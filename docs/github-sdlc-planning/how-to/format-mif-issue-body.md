---
id: 2abd706a-b420-4cf4-9d4a-f7dc2d11d3dd
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Format a MIF issue body with format_mif_issue_body
diataxis_type: how-to
---


Goal: prepend the MIF L1 frontmatter comment block to a Markdown body
yourself, without creating an issue — useful when composing a body ahead of
time or feeding it to a tool other than `create_issue` (which does this
prepending automatically).

## Prerequisites

- None — this is a pure string-transformation function; it makes no GitHub
  API call.

## Steps

1. Call `format_mif_issue_body`:

   ```json
   {
     "meta": { "id": "flaky-upload-retry", "type": "Bug", "namespace": "your-repo" },
     "body": "Uploads intermittently fail on slow connections."
   }
   ```

2. Read the result — a single string:

   ```text
   <!-- mif-id: urn:mif:concept:your-repo:flaky-upload-retry -->
   <!-- mif-type: Bug -->
   <!-- mif-ns: your-repo -->
   Uploads intermittently fail on slow connections.
   ```

## Verify it worked

- Confirm the three comment lines appear before your original body,
  unmodified, with `id` expanded into the full
  `urn:mif:concept:{namespace}:{id}` form.
- Feed the result back through [`parse_mif_issue_body`](parse-mif-issue-body.md)
  and confirm you get the original `meta` and `body` back.

See also: [tool reference](../reference/tools.md#format_mif_issue_body).
