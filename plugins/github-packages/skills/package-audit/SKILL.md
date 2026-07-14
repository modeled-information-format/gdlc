---
description: Audit an org's published packages and their versions, and present a summary for the user to review. Use when the user asks to "audit packages", "list our packages", or "check package versions". Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "audit packages for <org>", "list packages", "check versions of <package>", or a periodic package-inventory review request.
argument-hint: "[org] [package type]"
allowed-tools: mcp__github-packages__*, mcp__plugin_github-packages_github-packages__*
---

# Package audit

Audit published packages for **$ARGUMENTS**.

1. Call `mcp__github-packages__list_org_packages`. `packageType` is
   required by the real endpoint -- there is no single call that lists
   every type at once. If the user named a type, use it; otherwise call
   it once per known type (`npm`, `maven`, `rubygems`, `docker`,
   `container`, `nuget`, `generic`) and combine the results.
2. For each package of interest, call
   `mcp__github-packages__list_package_versions` to see its version
   history.
3. Present a summary: package name, type, visibility, version count, and
   any packages with an unusually high version count (could indicate a
   noisy/unpruned registry) for the user to judge — this skill surfaces
   findings, it does not decide what to delete.
4. This skill is **read-only**. It never calls `delete_package`,
   `delete_package_version`, `restore_package`, or
   `restore_package_version` on its own; if the user wants a package
   deleted or restored after reviewing the audit, that's a separate,
   explicit request they make directly.
