---
id: ced2658c-8ffb-4bff-8b49-90e528f35669
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's traffic views
diataxis_type: how-to
---

Read how many page views a repository has had over GitHub's 14-day rolling
window, broken down by day.

## Steps

1. Call `get_repo_traffic_views` with the repository's owner and name:

   ```text
   get_repo_traffic_views { owner: "octocat", repo: "example" }
   ```

2. Read the totals off the top-level fields, and the day-by-day breakdown
   off `daily`:

   ```json
   {
     "count": 512,
     "uniques": 71,
     "daily": [
       { "timestamp": "2026-06-22T00:00:00Z", "count": 40, "uniques": 12 }
     ]
   }
   ```

   `count` is total views in the window; `uniques` is unique visitors.
   `daily` has one entry per day GitHub reported; if GitHub's response
   omits the `views` array entirely, this tool returns `daily: []` rather
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

- [reference/tools.md](../reference/tools.md#get_repo_traffic_views) for the
  exact response schema.
- [get-repo-traffic-clones.md](get-repo-traffic-clones.md) for the sibling
  clone-traffic tool.
