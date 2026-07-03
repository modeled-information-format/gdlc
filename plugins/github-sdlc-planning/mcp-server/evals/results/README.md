# Eval results

Populated by running the `autoresearch` eval harness against
`../evals/evaluation.xml` (MCP server QA pairs) and each skill's
`evals/evals.json` (skill behavior evals, see `../../skills/*/evals/`).

Not run as part of this deliverable — the skill evals need a real Claude Code
session driving live GitHub API calls, which needs a sandbox repo (see the
manual prerequisites checklist). Once run, each result set lands here as
`{date}-{skill-or-mcp}-results.tsv` (per `autoresearch`'s own
`results_log.py` convention) so a regression in a later change is visible in
diff, per this deliverable's eval requirement.
