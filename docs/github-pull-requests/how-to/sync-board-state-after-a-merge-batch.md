---
id: 8a5e3c1f-6d9b-4a2e-9c1f-7b3a5e6d2c94
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: sync board state after a batch of PRs merge"
diataxis_type: how-to
---

Several PRs merged over the last day or so (end of sprint, a release
train, catching up after being out), and the issues they closed haven't
had their Projects v2 board field updated yet — they're still showing
whatever status they had before the PR landed. Rather than clicking
through each issue's board card by hand, this walks the same field-sync
tool across the whole batch of merged PRs.

## Steps

1. **List the PRs you need to process** — from whatever merged them (a
   release PR list, your own recent-merges view); this plugin doesn't
   enumerate recently-merged PRs for you.

2. **For each merged PR, confirm what it actually closed** before syncing
   anything — don't assume you remember correctly:

   ```text
   get_linked_issues { owner: "octo-org", repo: "widget-app", pullNumber: 88 }
   ```

   Each item in the result carries a `source`
   (`closing_reference` — GitHub's own `Fixes #N` parsing — or
   `heuristic`, this plugin's text-parse fallback) and `alreadyTracked`
   (whether the issue already carries MIF frontmatter from
   `github-sdlc-planning`). Treat a `heuristic`-sourced item with a bit
   more skepticism than a `closing_reference` one — it's a best-effort
   match, not GitHub's own authoritative closing-issue data.

3. **Sync the board field for that PR's closed issues:**

   ```text
   sync_linked_issues_project_field {
     owner: "octo-org", repo: "widget-app", pullNumber: 88,
     projectOwnerLogin: "octo-org", projectNumber: 1,
     fieldId: "<the Status field's node id>",
     value: { kind: "singleSelect", optionId: "<the Done option's id>" }
   }
   ```

   This only works on a **merged** PR — it fails with `not_merged`
   otherwise, so if you're processing PRs right as they merge rather than
   after the fact, make sure the merge has actually landed before calling
   this.

4. **Read the response's three buckets, not just `synced`:**
   `notFoundOnBoard` lists issue numbers the sync couldn't place on the
   board, and `skippedCrossRepo` lists closing issues that live in a
   different repo than the PR (this tool only syncs same-repo issues —
   cross-repo closes are reported, never guessed at). Both need your own
   follow-up; they aren't errors, but they aren't "handled" either.

5. **Repeat for each PR in your batch.** There's no multi-PR call — one
   `sync_linked_issues_project_field` call covers one PR's closed issues at
   a time.

## A known limitation worth knowing before you rely on this

The underlying board read this tool uses is unpaginated (it reads the
first 100 items). On a board with more than 100 items, an issue that's
genuinely on the board can come back in `notFoundOnBoard` simply because
it's outside that first page, not because it's actually missing. If your
board is large and you see an issue in `notFoundOnBoard` that you're
confident is on the board, check manually before treating it as a real
gap.
