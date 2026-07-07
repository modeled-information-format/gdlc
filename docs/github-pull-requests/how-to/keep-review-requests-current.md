---
id: 4f8c2a6d-9e3b-4d1a-8f7c-2a6e9d4b1f58
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: keep review requests current as a PR evolves"
diataxis_type: how-to
---

A PR has been open a while and its reviewer needs have changed — someone
you originally asked is out, a new area of the diff needs a different
team's eyes, or a reviewer already gave feedback and doesn't need to be
re-pinged. [The main tutorial](../tutorials/first-pr-linked-to-an-issue.md)
requests a reviewer once, at PR creation; this guide is the ongoing
maintenance of that list across the PR's life.

## Steps

1. **Check who's currently requested before changing anything:**

   ```text
   list_review_requests {
     owner: "octo-org", repo: "widget-app", pullNumber: 88
   }
   ```

   You get back `{ users, teams }` — the current state, not a history of
   who's been requested and removed over time. If you need to know who
   requested changes and cleared them (already reviewed), that's GitHub's
   review-state UI, not this tool — this only tells you who's still
   pending a requested review.

2. **Add a reviewer or team when new scope needs new eyes:**

   ```text
   request_review {
     owner: "octo-org", repo: "widget-app", pullNumber: 88,
     reviewers: ["octocat"], teamReviewers: ["platform-team"]
   }
   ```

   Both `reviewers` and `teamReviewers` are optional independently — pass
   just one if you're only adding a person or just a team.

3. **Remove a reviewer who's out, or already reviewed and doesn't need to
   stay pending:**

   ```text
   remove_review_request {
     owner: "octo-org", repo: "widget-app", pullNumber: 88,
     reviewers: ["octocat"]
   }
   ```

4. **Re-check the list after any change** — `list_review_requests` again —
   rather than assuming the add/remove call's own return value tells you
   the full current picture; it's cheap to confirm.

## If the PR gets closed or merged mid-review

`request_review` fails with `stale_target` if the PR isn't open anymore —
this isn't a bug to work around, it's the tool telling you the review
request you're about to make doesn't make sense against a PR that's
already done. If you hit this, check the PR's actual state before retrying
anything.

## When the PR merges

Once review requests settle and the PR merges, the follow-up step —
syncing the board field on every issue the PR closed — is a separate
workflow; see
[sync-board-state-after-a-merge-batch.md](sync-board-state-after-a-merge-batch.md).
