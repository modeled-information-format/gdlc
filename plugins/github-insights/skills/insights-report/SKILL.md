---
description: Build a repo health/activity report from traffic, contributor stats, community profile, and dependency-graph data. Use when the user asks to "report on repo health", "check traffic", or "summarize repo activity". Skill only — there is no matching Agent; invoke via the Skill tool, never the Agent tool's subagent_type (which will report "not found").
when_to_use: Trigger on "report on repo health for <owner>/<repo>", "check traffic", "how's community health looking", or a periodic activity-report request.
argument-hint: "[owner/repo]"
allowed-tools: mcp__github-insights__*, mcp__plugin_github-insights_github-insights__*
---

# Repo insights report

Build an activity/health report for **$ARGUMENTS**.

1. Call `mcp__github-insights__get_repo_traffic_views` and
   `mcp__github-insights__get_repo_traffic_clones`. If either returns a
   `github_api_error`, note that the current token likely lacks write
   access to the repo (traffic requires it) rather than assuming traffic
   is zero.
2. Call `mcp__github-insights__get_repo_contributor_stats`. If the result
   has `computing: true`, say GitHub is still computing these stats and
   suggest retrying shortly — do not report zero contributors.
3. Call `mcp__github-insights__get_community_profile` and
   `mcp__github-insights__get_dependency_graph_sbom`.
4. Present a summary: traffic trend, top contributors, community-health
   percentage and which default files are missing, and SBOM package
   count. This skill reports, it does not act — it never suggests or
   makes any repo change on its own.
