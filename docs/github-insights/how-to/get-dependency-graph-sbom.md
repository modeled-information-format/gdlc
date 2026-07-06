---
id: 358110d0-1ef4-42ef-9144-73796ec32008
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's dependency-graph SBOM summary
diataxis_type: how-to
---
# Get a repo's dependency-graph SBOM summary

Read a quick summary of a repository's SPDX SBOM — its spec version and
package count — without pulling the full document.

## Steps

1. Call `get_dependency_graph_sbom` with the repository's owner and name:

   ```text
   get_dependency_graph_sbom { owner: "octocat", repo: "example" }
   ```

2. Read the summary off the response:

   ```json
   { "spdxVersion": "SPDX-2.3", "packageCount": 47 }
   ```

   `spdxVersion` is the SPDX spec version GitHub generated the document
   against; `packageCount` is the number of entries in the SBOM's `packages`
   array.

## When this isn't enough

This tool is deliberately a summary, not a full SPDX client — it does not
expose license information, package relationships, or any other field of the
underlying SBOM document. If you need the full document, fetch
`GET /repos/{owner}/{repo}/dependency-graph/sbom` directly rather than
through this tool.

## If it fails

- **`missing_scope`**: no GitHub token was resolvable. Set `GITHUB_TOKEN` or
  run `gh auth login`.
- **`github_api_error`**: check the message for the underlying HTTP status —
  a repository with the dependency graph disabled, or one you can't access,
  surfaces as a non-2xx status here.

## See also

- [reference/tools.md](../reference/tools.md#get_dependency_graph_sbom) for
  the exact response schema.
