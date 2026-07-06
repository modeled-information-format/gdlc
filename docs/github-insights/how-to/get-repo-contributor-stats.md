---
id: 940c5c55-a958-49dd-8d27-0a2baffd99e9
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Get a repo's contributor stats
diataxis_type: how-to
---

Read per-contributor commit totals for a repository, and handle GitHub's
asynchronous-computation case correctly.

## Steps

1. Call `get_repo_contributor_stats` with the repository's owner and name:

   ```text
   get_repo_contributor_stats { owner: "octocat", repo: "example" }
   ```

2. Check the `computing` field before reading `contributors`:

   ```json
   {
     "computing": false,
     "contributors": [
       { "login": "octocat", "total": 214 },
       { "login": null, "total": 3 }
     ]
   }
   ```

   A `null` login means GitHub couldn't map that commit author to a GitHub
   account. Each entry's `total` is that contributor's all-time commit
   count on this repository.

3. **If `computing` is `true`**, GitHub is still computing the stats after a
   cache miss and `contributors` will be an empty array — this is not the
   real answer. Wait a few seconds and call the same tool again with the
   same `owner`/`repo` until `computing` comes back `false`.

## If it fails

- **`missing_scope`**: no GitHub token was resolvable. Set `GITHUB_TOKEN` or
  run `gh auth login`.
- **`github_api_error` with a 403**: a genuine permission denial (rate-limited
  403s are retried automatically up to three times first).

## See also

- [reference/tools.md](../reference/tools.md#get_repo_contributor_stats) for
  the exact response schema and the cache-miss behavior this tool wraps.
