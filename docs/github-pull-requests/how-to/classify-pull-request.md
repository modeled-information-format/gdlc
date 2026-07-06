---
id: 7f1b4e8a-2d6c-4a93-b7e5-9a3f2c8d6b41
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Label a PR's type, size, and risk with classify_pull_request
diataxis_type: how-to
---
# Label a PR's type, size, and risk with `classify_pull_request`

Apply `type:*`, `size:*`, and optionally `risk:*` labels to a pull request,
with size computed automatically from its diff.

## Prerequisites

- `github-pull-requests` installed.
- An open (or any existing) pull request in the target repository.
- Write access sufficient to create labels and modify a PR's labels.

## Steps

1. Pick a `type` from `feat`, `fix`, `chore`, `docs`, `refactor`, `test`,
   `perf`.
2. Optionally pick a `risk` from `low`, `medium`, `high`. Omit it if you
   don't want risk managed by this call.
3. Call `classify_pull_request`:

   ```json
   {
     "owner": "your-org",
     "repo": "your-repo",
     "pullNumber": 12,
     "type": "fix",
     "risk": "low"
   }
   ```

4. Read the response: `{ type, size, risk, changedLines, changedFiles,
   labelsApplied, labelsRemoved }`.

## Verify it worked

Check `labelsApplied` contains `type:<your type>`, `size:<computed size>`,
and (if supplied) `risk:<your risk>`. Open the PR on GitHub and confirm the
same labels are visible.

## Notes

- Size is computed from `additions + deletions`: `XS` (&lt;10 lines), `S`
  (&lt;30), `M` (&lt;100), `L` (&lt;500), `XL` (≥500) — the Danger.js /
  PR-size-labeler convention, not a plugin-specific scale.
- Re-running this call with a different `type` or `risk` replaces the
  stale label of that category (reported in `labelsRemoved`); it does not
  accumulate multiple `type:*` labels on the same PR.
- Omitting `risk` on a later call leaves any existing `risk:*` label
  untouched — it is not cleared just because you stopped supplying it.
- Missing labels (`type:fix`, `size:M`, etc.) are created automatically on
  first use, with fixed colors per category.
