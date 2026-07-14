---
description: Audit a repo's branch protection, rulesets, Pages status, and custom properties, and present a summary for the user to review. Use when the user asks to "audit repo config", "check branch protection", or "review repo governance settings". Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "audit repo config for <owner>/<repo>", "check branch protection on <branch>", "review governance settings", or a periodic repo-config review request.
argument-hint: "[owner/repo] [branch]"
allowed-tools: mcp__github-repo-config__*, mcp__plugin_github-repo-config_github-repo-config__*
---

# Repo config audit

Audit governance configuration for **$ARGUMENTS**.

1. Call `mcp__github-repo-config__get_branch_protection` for the named
   branch (default `main`) and `mcp__github-repo-config__list_repo_rulesets`
   for the repo.
2. Call `mcp__github-repo-config__get_pages_config` and
   `mcp__github-repo-config__get_repo_custom_properties` for the repo.
3. Present a summary: required status checks, enforce-admins, required
   approving reviews, active rulesets, Pages status, and custom property
   values. Flag anything that looks unusually permissive (e.g.
   `enforceAdmins: false` alongside a required-review count of 0) for the
   user to judge — this skill surfaces findings, it does not decide what
   is "too permissive."
4. This skill is **read-only**. It never calls `update_branch_protection`,
   `delete_branch_protection`, or `set_repo_custom_properties` on its own;
   if the user wants a config changed after reviewing the audit, that's a
   separate, explicit request they make directly.
