---
id: 77a02111-6b8d-4cf5-a538-6a52739301ef
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-insights tools
diataxis_type: reference
---
# github-insights tools

Five tools, registered in `plugins/github-insights/mcp-server/src/index.ts`.
Every tool takes the same input shape and issues exactly one `GET` request.
Names, descriptions, and input schemas below are copied verbatim from the
`server.registerTool` calls in source.

## Common input schema

All five tools share `repoRefSchema`:

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |

## `get_repo_traffic_views`

- **Purpose:** Read a repository's 14-day rolling page-view traffic.
- **Input:** `{ owner: string, repo: string }`
- **Underlying endpoint:** `GET /repos/{owner}/{repo}/traffic/views`
- **Returns:** `{ count, uniques, daily: [{ timestamp, count, uniques }, ...] }`

## `get_repo_traffic_clones`

- **Purpose:** Read a repository's 14-day rolling git-clone traffic.
- **Input:** `{ owner: string, repo: string }`
- **Underlying endpoint:** `GET /repos/{owner}/{repo}/traffic/clones`
- **Returns:** `{ count, uniques, daily: [{ timestamp, count, uniques }, ...] }`

## `get_repo_contributor_stats`

- **Purpose:** Read per-contributor commit totals. GitHub computes this
  asynchronously on a cache miss; a `computing: true` result means retry
  shortly rather than treating it as zero contributors.
- **Input:** `{ owner: string, repo: string }`
- **Underlying endpoint:** `GET /repos/{owner}/{repo}/stats/contributors`
- **Returns:** `{ computing: boolean, contributors: [{ login: string | null, total: number }, ...] }`
- **Note:** on a cache miss, GitHub returns HTTP 202 with an empty body while
  it computes the stats; the tool returns `{ computing: true, contributors: [] }`
  in that case rather than an empty list of contributors.

## `get_community_profile`

- **Purpose:** Read a repository's community-health profile: health
  percentage and which default files (README, LICENSE, CONTRIBUTING, etc.)
  are present.
- **Input:** `{ owner: string, repo: string }`
- **Underlying endpoint:** `GET /repos/{owner}/{repo}/community/profile`
- **Returns:**
  ```json
  {
    "healthPercentage": 0,
    "description": null,
    "hasReadme": false,
    "hasLicense": false,
    "hasContributing": false,
    "hasCodeOfConduct": false,
    "hasIssueTemplate": false,
    "hasPullRequestTemplate": false
  }
  ```
  Each `has*` boolean is `true` when GitHub's `files.*` entry for that file is
  non-null.

## `get_dependency_graph_sbom`

- **Purpose:** Read a repository's SPDX SBOM summary (spec version and
  package count) from the dependency graph.
- **Input:** `{ owner: string, repo: string }`
- **Underlying endpoint:** `GET /repos/{owner}/{repo}/dependency-graph/sbom`
- **Returns:** `{ spdxVersion: string, packageCount: number }`
- **Note:** deliberately thin — this is a summary of the SBOM (its SPDX
  version and how many packages it lists), not a full SPDX document client.

## Error shape

Every tool call that fails returns `isError: true` with a JSON body. Two
codes are possible, both defined in `errors.ts`:

| Code | Meaning |
| --- | --- |
| `missing_scope` | No GitHub token was available (`GITHUB_TOKEN` unset and `gh auth token` failed). |
| `github_api_error` | GitHub's REST API returned a non-2xx response other than a rate limit (the client already retries rate limits internally before surfacing an error — see [explanation/why-github-insights.md](../explanation/why-github-insights.md)). |

Any other thrown error (not an `InsightsError`) is wrapped as
`{ error: 'github_api_error', message: <err.message or String(err)> }`.

## Authentication

`resolveToken` in `github-client.ts` resolves a token in this order:

1. `GITHUB_TOKEN` environment variable, if set.
2. `gh auth token` (the active `gh` CLI login), as a fallback.

The resolved token is cached in-process for the life of the server.
