---
description: List an org's organization roles and their team/user assignments, and present a summary for the user to review. Use when the user asks to "audit org roles", "who has admin on this org", or "review organization role assignments". Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "audit org roles for <org>", "who has [role] in <org>", "review organization role assignments", or a periodic access-review request.
argument-hint: "[org]"
allowed-tools: mcp__github-org-identity__*, mcp__plugin_github-org-identity_github-org-identity__*
---

# Organization role audit

Audit organization role assignments for **$ARGUMENTS**.

1. Call `mcp__github-org-identity__list_organization_roles` for the org.
2. For each role, call `mcp__github-org-identity__list_role_teams` and
   `mcp__github-org-identity__list_role_users` to see who currently holds it.
3. Present a summary table: role name, source (predefined/organization),
   assigned teams, assigned users. Note any predefined broad-admin role
   (e.g. `all_repo_admin`) held by more teams/users than seem expected, for
   the user to judge — this skill flags for review, it does not decide what
   is "too broad."
4. This skill is **read-only**. It never calls `assign_team_role`,
   `remove_team_role`, `assign_user_role`, or `remove_user_role` on its own;
   if the user wants a role changed after reviewing the audit, that's a
   separate, explicit request they make directly.
