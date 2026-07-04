---
id: b7d34fad-591e-4fc7-b8eb-c78d2c9a760f
type: semantic
created: 2026-07-04T00:00:00Z
namespace: github-sdlc-plugins/github-insights
modified: 2026-07-04T00:00:00Z
title: github-insights
diataxis_type: reference
---
# github-insights

Read-only repo/org reporting: traffic (views/clones), contributor stats,
community-health profile, and a dependency-graph/SBOM summary. Tier-3
domain #5 (GitHub Insights) — passive reporting, not a planning surface.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-insights@github-sdlc-plugins
```

No dependency on the sibling plugins — standalone, pure REST.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `get_repo_traffic_views` / `get_repo_traffic_clones` | 14-day rolling page-view / git-clone traffic |
| `get_repo_contributor_stats` | Per-contributor commit totals |
| `get_community_profile` | Health percentage and which default files (README, LICENSE, CONTRIBUTING, etc.) are present |
| `get_dependency_graph_sbom` | SPDX spec version and package count from the dependency graph |

Every tool here is read-only by nature of the underlying GitHub REST API —
none of traffic, statistics, community-profile, or dependency-graph has a
write counterpart at all, so there is no confirm-echo contract in this
plugin (unlike `github-org-identity`/`github-repo-config`).

## Auth note: traffic needs write access, not just read

`get_repo_traffic_views`/`get_repo_traffic_clones` wrap GitHub's traffic
API, which — despite being a read-only GET — requires the calling
token to have **write (push) access** to the repository, not merely read
access. A read-only token gets a `github_api_error` (403) from these two
tools specifically; `get_repo_contributor_stats`, `get_community_profile`,
and `get_dependency_graph_sbom` only need read access. This is why
`live-integration-tests.yml` is not wired for this plugin either: none of
this repo's five GitHub Apps grant `contents: write` on arbitrary target
repos, which is what traffic actually needs.

## The 202-Accepted gotcha

`get_repo_contributor_stats` wraps `GET /repos/{owner}/{repo}/stats/contributors`,
which GitHub computes asynchronously on a cache miss: the first call for a
repo (or after a long gap) returns `202 Accepted` with an empty body while
the stats compute in the background. This tool reports that as
`{ computing: true, contributors: [] }` — **not** as zero contributors.
Callers that need the real numbers should retry after a short delay.

## Dependency-graph SBOM is deliberately thin

`get_dependency_graph_sbom` returns just `spdxVersion` and `packageCount`,
not the full SPDX document. The real SBOM is a large, deeply nested
external schema; modeling every field is out of scope for "is there an
SBOM and roughly how big is it."

## Live verification

`scripts/verify-live.ts` exercises every tool against a real repo
(defaults to `modeled-information-format`/`gdlc`) — safe to run in CI or
manually, since nothing here mutates state.
