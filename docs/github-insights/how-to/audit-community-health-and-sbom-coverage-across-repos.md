---
id: 9c6b3e5a-1d4f-4a8b-8e2c-7a5f9d3b6c21
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: audit community-health and SBOM coverage across several repos"
diataxis_type: how-to
---

You're preparing for a compliance or security review and need to know,
across a group of repos (a team's, an org's, whatever set you're
responsible for): which ones are missing basic community-health files, and
which ones don't have a dependency-graph SBOM at all. `github-insights` has
no bulk/org-wide tool for this — it only takes one `owner`/`repo` pair per
call — so the workflow is a loop over your repo list, not a single call.

## Steps

1. **List the repos in scope.** This plugin doesn't enumerate an org's
   repos for you; get that list from wherever you already track it (a
   spreadsheet, `gh repo list <org>`, your own inventory).

2. **For each repo, pull its community profile:**

   ```text
   get_community_profile { owner: "octo-org", repo: "widget-app" }
   ```

   Record `healthPercentage` and which `has*` booleans are `false`. A
   `hasCodeOfConduct: false` on one repo and `true` on nine others is worth
   flagging even if the percentage looks fine overall — a low percentage
   hides *which* file is missing, so read the booleans, not just the score.

3. **For each repo, pull its SBOM summary:**

   ```text
   get_dependency_graph_sbom { owner: "octo-org", repo: "widget-app" }
   ```

   A `packageCount` of `0` with a valid `spdxVersion` usually means the
   dependency graph is enabled but the repo genuinely has no tracked
   dependencies (plausible for a tiny repo) — that's different from the
   call erroring outright, which usually means the dependency graph isn't
   enabled for that repo at all. Note both cases distinctly in your audit;
   don't collapse them into one "no SBOM" bucket.

4. **Build your findings table as you go.** Since this plugin returns one
   repo's data per call and doesn't aggregate, the simplest approach is a
   running table: one row per repo, columns for health percentage, which
   `has*` files are missing, and SBOM status. You fill it in call by call.

5. **Triage before escalating.** A repo missing `hasContributing` might just
   need a file added — cheap to fix. A repo whose SBOM call errors outright
   is a bigger flag (dependency graph isn't enabled, which usually means no
   one's watching its dependency vulnerabilities) and deserves separate
   follow-up, not the same one-line note as a missing CONTRIBUTING.md.

## When a repo won't respond

If a call for one repo in your list comes back `missing_scope`, your token
doesn't have access to that specific repo — this is a per-repo failure, not
a sign the whole audit is broken. Skip it, note it as "needs access," and
keep going through the rest of your list; don't stop the whole pass over
one repo's auth gap. See
[reference/tools.md](../reference/tools.md#error-shape) for the two error
codes this plugin can return.
