---
description: Read an existing bug issue, suggest a severity, and (with confirmation) apply it to the issue's label and the triage board. Use when the user asks to "triage this issue", "suggest a severity for #N", or "review this bug".
when_to_use: Trigger on "triage issue #N", "suggest a severity", "what severity should this be", or "review this bug report".
argument-hint: "<owner/repo> <issue number>"
allowed-tools: Bash, mcp__github-bug-capture__ensure_severity_field, mcp__plugin_github-bug-capture_github-bug-capture__ensure_severity_field, mcp__github-bug-capture__set_severity, mcp__plugin_github-bug-capture_github-bug-capture__set_severity
---

# Triage

Triage issue **$ARGUMENTS**.

1. **Check the pack toggle.** Run:

   ```bash
   node -e "import('$CLAUDE_PLUGIN_ROOT/hooks/lib/settings.mjs').then(m => process.exit(m.isPackEnabled('triage-skills', process.cwd()) ? 0 : 1))"
   ```

   If it exits non-zero, explain that the triage-skills pack is disabled
   (point at `docs/pack-toggles.md`) and stop.

2. **Read the issue**: `gh issue view <number> --repo <owner/repo> --json
   number,title,body,labels,state`. Do not guess its content from context —
   read it fresh.

3. **Suggest a severity** (Critical/High/Medium/Low) from the title/body:
   data loss, security, or a crash with no workaround -> Critical; a broken
   build/test suite or a blocking regression -> High; a functional bug with a
   workaround -> Medium; cosmetic/typo/non-blocking -> Low. If the issue
   already carries a `severity:*` label, note whether your suggestion agrees
   or differs, and why.

4. **Confirm with the user before changing anything.** Present the current
   state, the suggested severity, and your reasoning; do not call any
   mutating tool until the user agrees on a level (which may be your
   suggestion, the existing label, or something else entirely).

5. **On confirmation, apply it two ways:**
   - The label: `source scripts/gh-bug.sh && bug_edit <number> --severity
     <level-lowercase> --repo <owner/repo>` — reuse the existing shell
     affordance's label-swap logic rather than re-implementing it.
   - The triage board (only if this repo has one — ask for its
     `projectOwnerLogin`/`projectNumber` if not already known): call
     `ensure_severity_field` (idempotent), then `set_severity` with the
     capitalized level to set the board's `Severity` field on this issue.

6. **Report back**: the level applied, and confirmation that both the label
   and (if applicable) the board field were updated.
