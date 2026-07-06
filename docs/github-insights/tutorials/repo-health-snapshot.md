---
id: c0518daa-f627-43c6-8d6b-98e1b951f6d6
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: "Tutorial: pull a repo health snapshot"
diataxis_type: tutorial
---
# Tutorial: pull a repo health snapshot

This tutorial walks through pulling a complete, four-domain health snapshot
of a single repository — traffic, contributors, community profile, and
SBOM — using nothing but `github-insights`'s five tools, in order, on one
example repo. By the end you will have made all five calls once and know
what a normal response looks like for each.

## Before you start

- `github-insights` is installed (`/plugin install github-insights@github-sdlc-plugins`).
- You're authenticated: either `GITHUB_TOKEN` is set in your environment, or
  you're logged in via `gh auth login`.
- GitHub's traffic endpoints require push access to the target repository
  (per GitHub's own REST API documentation); this tutorial assumes you're
  running it against a repo you have push access to.

Pick a repository to snapshot. This tutorial uses `owner/repo` as a
placeholder — substitute a real repository you have access to.

## Step 1 — check community health first

Community health doesn't depend on any asynchronous computation, so it's the
simplest tool to start with and confirms your auth is working before you
move on to the trickier ones.

Call:

```text
get_community_profile { owner: "owner", repo: "repo" }
```

You should get back something like:

```json
{
  "healthPercentage": 87,
  "description": "A repository doing repository things.",
  "hasReadme": true,
  "hasLicense": true,
  "hasContributing": true,
  "hasCodeOfConduct": false,
  "hasIssueTemplate": true,
  "hasPullRequestTemplate": true
}
```

If this call fails with `missing_scope`, stop here and fix your
authentication (`gh auth login`) before continuing — every later call in
this tutorial needs the same token.

## Step 2 — pull traffic views and clones

These two are separate tools because they hit separate GitHub endpoints, but
they return the same shape.

```text
get_repo_traffic_views { owner: "owner", repo: "repo" }
get_repo_traffic_clones { owner: "owner", repo: "repo" }
```

Each returns:

```json
{
  "count": 142,
  "uniques": 38,
  "daily": [
    { "timestamp": "2026-06-22T00:00:00Z", "count": 12, "uniques": 5 },
    { "timestamp": "2026-06-23T00:00:00Z", "count": 9, "uniques": 4 }
  ]
}
```

`count`/`uniques` are the 14-day rolling totals; `daily` is one entry per day
in that window. If the repo has had no traffic in the window, `daily` is
still an array (possibly all-zero entries), not `null` — the tool defaults
to `[]` only if GitHub's response omits the `views`/`clones` field entirely.

## Step 3 — pull contributor stats, and handle the "still computing" case

This is the one tool in the plugin with a real wrinkle: on a cache miss,
GitHub computes contributor stats asynchronously and returns nothing useful
on the first call.

```text
get_repo_contributor_stats { owner: "owner", repo: "repo" }
```

You'll see one of two shapes. If GitHub already has the stats cached:

```json
{
  "computing": false,
  "contributors": [
    { "login": "octocat", "total": 214 },
    { "login": null, "total": 3 }
  ]
}
```

(A `null` login means a commit whose author GitHub couldn't map to a GitHub
account.)

If it's a cache miss:

```json
{ "computing": true, "contributors": [] }
```

**Treat `computing: true` as "try again in a few seconds," not "zero
contributors."** Re-issue the same call after a short pause until
`computing` comes back `false`. This is exactly the behavior the tool's own
description warns about — see
[reference/tools.md](../reference/tools.md#get_repo_contributor_stats).

## Step 4 — pull the SBOM summary

```text
get_dependency_graph_sbom { owner: "owner", repo: "repo" }
```

```json
{ "spdxVersion": "SPDX-2.3", "packageCount": 47 }
```

This is a summary, not the full SBOM — see
[reference/tools.md](../reference/tools.md#get_dependency_graph_sbom) if you
need the underlying document itself (fetch it directly from GitHub's API;
this plugin doesn't expose it in full).

## What you've got

At this point you've made all five calls and have, for one repository: how
much traffic it's getting, who's committing to it, how healthy its
community-file coverage is, and whether it has an SBOM. Combining all four
into a single "repo health" view for reporting or triage is a matter of
collecting these five JSON payloads — the plugin doesn't merge them for you,
by design (each is a distinct GitHub domain with its own refresh cadence and
caveats).

## Next steps

- For a task-oriented recipe per tool (including how each error case
  surfaces), see the how-to guides under `how-to/`.
- For the exact input/output contract of every tool, see
  [reference/tools.md](../reference/tools.md).
- For why this plugin has no mutation tools and how it handles GitHub's rate
  limits, see [explanation/why-github-insights.md](../explanation/why-github-insights.md).
