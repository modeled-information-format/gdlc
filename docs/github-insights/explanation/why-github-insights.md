---
id: e5487640-a118-49ef-b57e-ea236e81167b
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-insights
diataxis_type: explanation
---

## What problem it solves

GitHub exposes a handful of read-only reporting surfaces — traffic views and
clones, per-contributor commit totals, a repository's community-health
profile, and a dependency-graph SBOM summary — each behind its own REST
endpoint, its own response shape, and its own quirks (asynchronous
computation, ambiguous 403s, a deeply nested SPDX document). `github-insights`
wraps exactly those four endpoints as five MCP tools (traffic is split into
views and clones) so an agent or a script can pull them without re-deriving
GitHub's rate-limit and cache-miss handling from scratch every time.

The plugin is **standalone**: its manifest
(`plugins/github-insights/.claude-plugin/plugin.json`) declares no
`dependencies`, and none of its tools call into any sibling plugin.

## Read-only by construction

Every tool in this plugin issues an HTTP `GET`. The underlying REST
endpoints it wraps — `/repos/{owner}/{repo}/traffic/views`, `.../traffic/clones`,
`.../stats/contributors`, `.../community/profile`, `.../dependency-graph/sbom`
— have no write counterpart at all, a fact called out directly in
`github-client.ts`'s `resolveToken` doc comment.

This matters for two reasons that mutation-heavy sibling plugins (the
planning and PR plugins, `github-bug-capture`) have to solve and
`github-insights` does not:

- **No mutation pacing.** Sibling `github-client.ts` modules enforce a hard
  minimum interval between content-creating calls
  (`enforceMutationPacing`) to avoid tripping GitHub's abuse-detection
  rate limits on bursts of writes. `github-insights` has no such governor —
  there is nothing to pace, because nothing it does creates or changes
  content.
- **No confirmation guard.** `InsightsError`'s own doc comment notes there is
  no `confirmation_mismatch` error code here, unlike plugins that gate
  destructive calls behind a confirmation token — a read has nothing to
  confirm.

The plugin still has to handle GitHub's read-side subtleties correctly:
`githubGet` in `github-client.ts` distinguishes a secondary (abuse-detection)
rate limit from a primary (request-budget) rate limit from a plain permission
denial, backing off and retrying (up to three attempts) only for the two rate
limit cases; a plain 403 surfaces immediately as an `InsightsError` with code
`github_api_error`. `get_repo_contributor_stats` additionally has to treat a
202 response (GitHub is still computing the stats after a cache miss) as
"retry shortly," not "zero contributors" — see
[reference/tools.md](../reference/tools.md) for the exact shape each tool
returns.

## Data domains covered

| Domain | Tools | What it answers |
| --- | --- | --- |
| Traffic | `get_repo_traffic_views`, `get_repo_traffic_clones` | How many people viewed or cloned this repo over GitHub's 14-day rolling window? |
| Contributors | `get_repo_contributor_stats` | Who has committed to this repo, and how many commits each? |
| Community health | `get_community_profile` | Does this repo have the files GitHub considers markers of a healthy open-source project (README, LICENSE, CONTRIBUTING, etc.), and what's its overall health percentage? |
| Dependency graph | `get_dependency_graph_sbom` | Does this repo have an SBOM, which SPDX spec version, and roughly how many packages does it list? |

The SBOM tool is deliberately thin: the full SPDX document is a large,
deeply nested external schema, and `dependency-graph.ts`'s own doc comment
is explicit that modeling every field is out of scope — the tool surfaces
just enough (`spdxVersion`, `packageCount`) to answer "is there an SBOM and
roughly how big is it," not to be a full SPDX client.

## ADR audit finding

This repository's three accepted ADRs
([ADR-0001](../../decisions/adr-0001-bug-capture-layer1-core.md),
[ADR-0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md),
[ADR-0003](../../decisions/adr-0003-board-status-hygiene.md)) were read in
full for this audit. **None govern `github-insights`.** All three concern
`github-bug-capture`'s Layer 1 architecture, the PR-to-issue linkage boundary
between `github-pull-requests` and `github-bug-capture`, and Projects v2
board-status hygiene for `github-sdlc-planning` — none reference traffic,
contributor stats, community profiles, or the dependency graph, and none of
their decision text, consequences, or audit trails mention this plugin. This
is consistent with `github-insights` being a standalone, dependency-free
plugin with no board, PR, or issue-lifecycle surface for those ADRs to touch.
