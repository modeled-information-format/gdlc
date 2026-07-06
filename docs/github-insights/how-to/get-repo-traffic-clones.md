---
id: 2d916dd5-2f43-4c4e-af89-005a4d17f422
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's traffic clones
diataxis_type: how-to
---

Read how many times a repository has been git-cloned over GitHub's 14-day
rolling window, broken down by day.

## Steps

1. Call `get_repo_traffic_clones` with the repository's owner and name:

   ```text
   get_repo_traffic_clones { owner: "octocat", repo: "example" }
   ```

2. Read the totals off the top-level fields, and the day-by-day breakdown
   off `daily`:

   ```json
   {
     "count": 88,
     "uniques": 19,
     "daily": [
       { "timestamp": "2026-06-22T00:00:00Z", "count": 6, "uniques": 3 }
     ]
   }
   ```

   `count` is total clones in the window; `uniques` is unique cloners.
   `daily` has one entry per day GitHub reported; if GitHub's response
   omits the `clones` array entirely, this tool returns `daily: []` rather
   than failing.

## If it fails

- **`missing_scope`**: no GitHub token was resolvable. Set `GITHUB_TOKEN` or
  run `gh auth login`.
- **`github_api_error` with a 403**: check whether it's a genuine permission
  problem (you need push access to the repository to read its traffic) —
  a rate-limited 403 is retried automatically up to three times before this
  error surfaces, so if you see it, it isn't a rate limit that will clear on
  its own.

## See also

- [reference/tools.md](../reference/tools.md#get_repo_traffic_clones) for the
  exact response schema.
- [get-repo-traffic-views.md](get-repo-traffic-views.md) for the sibling
  view-traffic tool.
