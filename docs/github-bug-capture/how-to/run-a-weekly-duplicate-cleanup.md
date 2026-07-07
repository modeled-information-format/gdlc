---
id: 7d2a9c4e-1b6f-4d8a-9e3c-5f1a7d2b8e63
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: run a weekly duplicate-cleanup pass"
diataxis_type: how-to
---

Your bug tracker has accumulated a backlog, and some of it is duplicates —
the same crash filed three different ways by three different people who
each ran their own search and didn't find each other's report (or didn't
search at all). This is a periodic sweep across the whole backlog, not the
one-off "check before filing" step in
[wire-bug-capture-into-your-dev-loop.md](wire-bug-capture-into-your-dev-loop.md).

## Steps

1. **Pull your open backlog** from wherever you track it (a board view, a
   label filter, `gh issue list`) — this plugin doesn't enumerate a whole
   backlog for you; `search_similar_issues` searches by query, not by
   listing everything open.

2. **Group backlog issues by rough topic yourself first.** Skim titles for
   obvious clusters (multiple issues that sound like the same crash, same
   error message, same feature area) before running searches — this saves
   you from running one query per issue when several issues clearly belong
   to the same cluster.

3. **For each suspected cluster, confirm with a real search** rather than
   trusting title similarity alone:

   ```text
   search_similar_issues {
     owner: "octo-org", repo: "widget-app",
     query: "save crash filename slash"
   }
   ```

   Read the returned `candidates` — plain keyword search can both
   over-match (similar words, unrelated bug) and under-match (same bug,
   different words), so confirm each candidate is actually the same issue
   before treating it as a duplicate, not just a similar-sounding one.

4. **Pick the canonical issue for each real duplicate cluster** — usually
   the oldest, or the one with the most detail/discussion — and close
   every other issue in the cluster against it:

   ```text
   close_as_duplicate {
     owner: "octo-org", repo: "widget-app",
     issueNumber: 231, duplicateOfNumber: 219
   }
   ```

   This closes #231 with `state_reason: duplicate` and posts a comment on
   it linking to #219 — reporters of the duplicate get a pointer to where
   the real discussion is happening, they aren't just silently closed out.

5. **Do this one cluster at a time, not as a giant batch you queue up
   first.** Confirming each candidate before closing it means false
   matches get caught before anything closes, not after.

## What this pass won't catch

`search_similar_issues` is keyword search, not semantic similarity — a
duplicate described in completely different words (no shared vocabulary
with the canonical issue) won't surface from a query built around the
canonical issue's own wording. If your backlog has a lot of these, you'll
need to catch them the way you did in step 2: by reading titles and
recognizing the pattern yourself, then confirming with a query built around
the new issue's specific wording instead.
