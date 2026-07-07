---
id: 3f9d1a2e-6b71-4b6a-9c3f-8e2a7d4c5f10
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: track a traffic bump across two check-ins"
diataxis_type: how-to
---

You just posted about your project somewhere (a blog, a forum, a launch
thread) and want to know whether it actually moved the needle on traffic —
not "traffic went up," but by how much, compared to before.

`get_repo_traffic_views` and `get_repo_traffic_clones` each return GitHub's
14-day *rolling* window, not a date-range you choose. There's no
`since`/`until` parameter to ask for "last month vs. this month" in one
call. The workflow is to take a snapshot now, take a second snapshot later,
and diff the two yourself.

## Steps

1. **Snapshot before you post.** Right before publishing, call both traffic
   tools and save the result somewhere you'll find it again (a note, a
   scratch file, a comment on the tracking issue):

   ```text
   get_repo_traffic_views { owner: "octo-org", repo: "widget-app" }
   get_repo_traffic_clones { owner: "octo-org", repo: "widget-app" }
   ```

   Record the `count` and `uniques` totals from each, and the date you ran
   this. That's your baseline.

2. **Post, then wait out the window.** Because the tools report a 14-day
   rolling total, wait at least a few days before checking again — checking
   an hour later just shows the same window with your post barely in it.
   Waiting the full 14 days gives you a clean before/after with no overlap.

3. **Snapshot again.** Call the same two tools the same way. Compare the new
   `count`/`uniques` totals to your baseline. The `daily` array in each
   response lets you see which specific day(s) spiked, not just the
   14-day sum — look for the date you posted and the days right after.

4. **Watch for a `daily` entry of all zeros, not a missing day.** A quiet
   day is a real `{ timestamp, count: 0, uniques: 0 }` entry, not an absence
   — if you're diffing day-by-day, index by `timestamp`, don't assume the
   array is dense from day 1.

5. **Cross-check against contributor activity if the bump looks unusual.**
   A traffic spike with no corresponding uptick in `get_repo_contributor_stats`
   commit activity is just readers, which is the expected shape for a
   launch post. A spike that also shows new contributor logins suggests the
   post drove code contributions too, not just views — worth calling out
   differently in a report.

## Why this is manual

The plugin deliberately doesn't store history or compute deltas for you —
see [explanation/why-github-insights.md](../explanation/why-github-insights.md)
for why it stays read-only and stateless. If you need this repeatedly,
saving each snapshot's raw JSON (with the date you pulled it) is enough to
build your own before/after diffs without asking the plugin to become
something it isn't.
