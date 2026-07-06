---
id: 4fa28a3b-739d-4d7c-b954-5c0099e9a3e3
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Check for duplicate issues before filing
diataxis_type: how-to
---

Use this before filing a new bug issue, to surface candidate duplicates via
keyword search.

## Steps

1. Call with a short, keyword-heavy query describing the defect — not the
   full draft title or body:

   ```text
   search_similar_issues {
     owner: "<owner>",
     repo: "<repo>",
     query: "crash save filename slash"
   }
   ```

2. Read the response:

   ```json
   {
     "candidates": [
       { "number": 88, "title": "App crashes saving files with slashes", "state": "open", "htmlUrl": "https://github.com/..." }
     ],
     "totalCount": 1
   }
   ```

3. Review each candidate's `title` and `state` yourself. This is a plain
   keyword search against GitHub's `search/issues` REST endpoint — it does
   not rank by semantic similarity, so a candidate appearing here is not a
   confirmed duplicate, and a real duplicate phrased very differently may
   not appear at all.

4. If you find a genuine duplicate among the candidates, file nothing new;
   if the new report is itself the duplicate, see
   [close-as-duplicate.md](close-as-duplicate.md).

## Notes

- This tool only searches; it never files or closes anything.
- AI/embedding-based similarity is explicitly out of scope for this tool
  per the plugin's originating research report — don't expect matches based
  on meaning rather than shared keywords.

## See also

- [reference/tools.md](../reference/tools.md#search_similar_issues) — full
  input/output schema.
- [how-to/close-as-duplicate.md](close-as-duplicate.md) — once you've
  confirmed a duplicate.
