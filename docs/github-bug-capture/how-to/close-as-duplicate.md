---
id: 55417626-1069-4ad4-b664-55cb9c9eb840
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Close an issue as a duplicate
diataxis_type: how-to
---
# Close an issue as a duplicate

Use this once you've confirmed an issue is a duplicate of another, already
open (or previously filed) issue.

## Steps

1. Confirm the canonical issue number first — typically the result of a
   prior [search_similar_issues](search-similar-issues.md) call, or manual
   review.

2. Call:

   ```text
   close_as_duplicate {
     owner: "<owner>",
     repo: "<repo>",
     issueNumber: <n>,
     duplicateOfNumber: <canonical-issue-number>
   }
   ```

3. This performs two actions in sequence: it closes `issueNumber` with
   `state_reason: "duplicate"` via REST PATCH, then posts a comment on it
   reading `Closing as a duplicate of #<duplicateOfNumber>.`

4. The response includes `commentUrl` — the URL of the comment GitHub just
   created. Use it to confirm the comment posted as expected.

## Notes

- This tool does not verify that `duplicateOfNumber` actually exists or is
  related — pass the number you've already confirmed yourself (see
  [search-similar-issues.md](search-similar-issues.md)).
- Closing as a duplicate does not touch the triage board's `Severity` or
  `Status` fields directly; GitHub's native "Item closed" Projects v2
  workflow, if enabled on your board, handles the board-side transition
  (see [ADR-0003](../../decisions/adr-0003-board-status-hygiene.md)).

## See also

- [reference/tools.md](../reference/tools.md#close_as_duplicate) — full
  input/output schema.
