---
description: File a diagnostic (a test failure, lint error, build break, or other observed defect) as a structured, MIF-conformant GitHub issue, after checking for likely duplicates and inferring a severity. Use when the user asks to "file a bug", "report this as an issue", "capture this diagnostic", or when the hooks-pack's diagnostic-capture hook points at this skill. Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "file a bug", "file this as an issue", "capture this diagnostic", "report this failure", or a diagnostic-capture hook's additionalContext recommending this skill.
argument-hint: "<owner/repo> <diagnostic description or captured failure text>"
allowed-tools: Bash, mcp__github-bug-capture__search_similar_issues, mcp__plugin_github-bug-capture_github-bug-capture__search_similar_issues, mcp__github-bug-capture__ensure_severity_field, mcp__plugin_github-bug-capture_github-bug-capture__ensure_severity_field, mcp__github-bug-capture__set_severity, mcp__plugin_github-bug-capture_github-bug-capture__set_severity, mcp__github-sdlc-planning__create_issue, mcp__plugin_github-sdlc-planning_github-sdlc-planning__create_issue, mcp__github-sdlc-planning__add_item_to_project, mcp__plugin_github-sdlc-planning_github-sdlc-planning__add_item_to_project
---

# File bug

File **$ARGUMENTS** as a bug issue.

1. **Check the pack toggle.** Run:

   ```bash
   node -e "import('$CLAUDE_PLUGIN_ROOT/hooks/lib/settings.mjs').then(m => process.exit(m.isPackEnabled('triage-skills', process.cwd()) ? 0 : 1))"
   ```

   If it exits non-zero, the triage-skills pack is disabled. Explain that to
   the user (point at `docs/pack-toggles.md`) and stop — do not file anything.

2. **Identify the target.** Confirm `owner/repo` from `$ARGUMENTS` or the
   current repo context — a concrete value is needed before the duplicate
   check in step 3 can run (that tool has no config-driven default). Ask
   the user if neither source gives one. Draft a concise `title` and a
   `body` describing the diagnostic (if this was triggered by the
   hooks-pack, the captured excerpt goes verbatim into the body).

   Separately: `create_issue` (step 5)'s own `owner`/`repo` are optional
   and default from the project's or global's `destination.repo`
   (`.config/gdlc/config.yml` -- see
   [the config schema](../../../../docs/reference/config-schema.md)). That
   default isn't reachable through this skill's flow, since step 3's
   duplicate check needs a concrete target first — it matters for a direct,
   non-interactive MCP call to `create_issue` that skips this skill
   entirely.

3. **Check for duplicates first** (the same underlying search the dedup-check
   skill uses, not re-implemented here): call `search_similar_issues` with
   `{ owner, repo, query: <a few keywords from the title> }`. If candidates
   come back, show them to the user (number,
   title, state, URL) and ask whether to proceed with a new issue anyway, or
   stop here so the user can comment on/reopen an existing one instead. Do
   not file a new issue without this check.

4. **Infer a severity** (Critical/High/Medium/Low) from the diagnostic text:
   data loss, security, or a crash with no workaround -> Critical; a broken
   build/test suite or a blocking regression -> High; a functional bug with a
   workaround -> Medium; cosmetic/typo/non-blocking -> Low. State the inferred
   level and let the user override it before filing.

5. **Create the issue** via `create_issue` (owned by `github-sdlc-planning`
   per [ADR-0002](../../../../docs/decisions/adr-0002-pr-issue-linkage-ownership.md)
   — this plugin composes, it does not reimplement issue creation):
   - `labels: ["bug", "severity:<level-lowercase>"]` — matches the
     `scripts/gh-bug.sh` label convention.
   - `mif: { id: <a short slug>, type: "Bug", namespace: <a project namespace> }`.
   - `body`: the diagnostic text (plus any duplicate candidates worth noting).

6. **Reflect the same severity on the triage board**, omitting
   `projectOwnerLogin`/`projectNumber` on each call below so they default
   from the configured `board:` mapping (same `.config/gdlc/config.yml`).
   If a call reports `missing_board_config` (no mapping anywhere and none
   given), ask the user for the board's `projectOwnerLogin`/`projectNumber`,
   or skip this step if there isn't one:
   - `add_item_to_project` (planning's tool) to place the new issue on the
     board.
   - `ensure_severity_field` (idempotent; safe to call every time) so the
     board's `Severity` single-select field exists.
   - `set_severity` with the capitalized level (`Critical`/`High`/`Medium`/`Low`)
     to set it on the new issue's board item.

7. **Report back**: the created issue's number/URL, the severity applied (as
   both a label and, if applicable, a board field), and any duplicate
   candidates surfaced in step 3.
