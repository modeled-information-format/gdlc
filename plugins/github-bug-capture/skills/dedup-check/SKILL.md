---
description: Check a draft bug title/body against existing issues for likely duplicates before filing. Use when the user asks to "check for duplicates", "is this already reported", "dedup check", or as the first step the file-bug skill delegates to. Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "check for duplicates", "dedup check", "has this already been reported", or automatically as step 3 of the file-bug skill.
argument-hint: "<owner/repo> <draft title or keywords>"
allowed-tools: Bash, mcp__github-bug-capture__search_similar_issues, mcp__plugin_github-bug-capture_github-bug-capture__search_similar_issues
---

# Dedup check

Check **$ARGUMENTS** for likely duplicate issues.

1. **Check the pack toggle.** Run:

   ```bash
   node -e "import('$CLAUDE_PLUGIN_ROOT/hooks/lib/settings.mjs').then(m => process.exit(m.isPackEnabled('triage-skills', process.cwd()) ? 0 : 1))"
   ```

   If it exits non-zero, explain that the triage-skills pack is disabled
   (point at `docs/pack-toggles.md`) and stop.

2. **Extract keywords** from the draft title/body in `$ARGUMENTS` — the two
   or three most distinctive terms (error name, function/module name,
   symptom), not the whole sentence; the search is a plain keyword match, not
   semantic similarity.

3. **Call `search_similar_issues`** with `{ owner, repo, query: <keywords> }`.
   This is a plain REST `search/issues` keyword search (not AI/embedding
   similarity, which the research report behind this plugin flags as a
   separate, out-of-scope concern) — treat its candidates as leads to review,
   not a definitive duplicate verdict.

4. **Report the candidates** as a short table (number, title, state, URL),
   ranked by how closely each title matches the keywords. If there are zero
   candidates, say so plainly ("no likely duplicates found").

5. **Do not act on the result yourself** — this skill only reports. Filing a
   new issue is `file-bug`'s job; closing an existing issue as a duplicate is
   the `close_as_duplicate` tool, used by the `triage` skill or directly by
   the user, never invoked here.
