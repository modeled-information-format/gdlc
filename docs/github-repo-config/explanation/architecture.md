---
id: d7a48565-ac3c-4fc7-b1fb-80846b547b85
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-repo-config is standalone
diataxis_type: explanation
---
# Why github-repo-config is standalone

`github-repo-config` covers repo/org governance: branch protection and
rulesets, org-wide `.github` community health files, GitHub Pages status,
and custom repository properties. It is one of this marketplace's
Tier-3 domains — narrower, more mature surfaces that don't need the
planning-plugin composition the Tier-1/Tier-2 plugins build on
(`github-sdlc-planning`, `github-pull-requests`, `github-bug-capture`).

## Standalone by design, not by omission

Every other plugin in this catalog that touches issues, PRs, or the
project board declares a `dependencies` edge on `github-sdlc-planning`
(directly or transitively) because they share state: an issue's MIF
frontmatter, a board item's Status field, a PR's linked-issue list.
`github-repo-config`'s four domains don't share any of that. Branch
protection, rulesets, Pages, and custom properties are configuration
reads and writes against a single repo or org — there's no board item,
no issue lifecycle, no cross-plugin state to reconcile. The plugin's
`.claude-plugin/plugin.json` carries no `dependencies` array, and its
`mcp-server` has its own `github-client.ts` (token resolution, rate-limit
classification, mutation pacing) rather than importing another plugin's.
That duplication of a small client module is deliberate: a dependency
edge here would buy nothing but coupling, since nothing about this
plugin's behavior depends on planning or PR state.

## Domain coverage

The plugin's 11 tools split into four GitHub domains, deliberately scoped
to what's mature and generally available rather than the full surface of
repo administration:

- **Branch protection** (`get_branch_protection`, `update_branch_protection`,
  `delete_branch_protection`) — the classic, single-rule-per-branch
  protection API.
- **Rulesets** (`list_repo_rulesets`, `get_repo_ruleset`) — the
  forward-compatible successor to branch protection, read-only in this
  plugin. See [reference/tools.md](../reference/tools.md) for the
  read-only scope boundary and why.
- **Community health files** (`list_org_health_files`, `get_org_health_file`)
  — the org-wide defaults (issue/PR templates, CONTRIBUTING,
  CODE_OF_CONDUCT, SECURITY) GitHub reads from the org's public `.github`
  repo, never `.github-private`.
- **Pages** (`get_pages_config`) — read-only status/build-type for a
  repo's published site.
- **Custom properties** (`list_custom_properties_schema`,
  `get_repo_custom_properties`, `set_repo_custom_properties`) — an org's
  custom repository-property schema and per-repo values, including a
  bulk write across multiple repos.

Two of the two write-capable tool families (`delete_branch_protection`
and `set_repo_custom_properties`) carry a confirm-echo contract — the
caller must repeat back a value that already appears in the primary
input (`confirmBranch`/`confirmRepoCount`) before the tool makes any API
call. `update_branch_protection` doesn't need this because GitHub's PUT
endpoint already forces the caller to state the full desired protection
state in one call; there's no partial-patch path that could silently
clear a field the caller didn't mention. Rulesets and Pages stay
read-only entirely in this pass: ruleset writes carry the same
broad-blast-radius risk as branch protection and need their own
confirm-echo design, and Pages enable/disable is a live-site risk this
plugin doesn't take on for a domain its own scoping already treats as
orthogonal to planning.

## ADR audit finding

This marketplace's `docs/decisions/` directory holds three accepted
ADRs as of this writing: ADR-0001 (MCP-server core for
`github-bug-capture`'s Layer 1), ADR-0002 (PR-to-issue linkage ownership,
assigning that capability to `github-pull-requests`), and ADR-0003
(board-status hygiene, relying on the org project's native Projects v2
workflows). All three were read in full for this audit.

**None govern `github-repo-config`.** Each ADR's context, decision, and
consequences are scoped specifically to bug-capture's core architecture,
PR/issue linkage ownership, and Projects v2 board automation — domains
`github-repo-config` doesn't touch. None of the three mention branch
protection, rulesets, Pages, or custom properties, and none constrain
how a standalone, dependency-free plugin like this one should be
structured. If a future ADR addresses cross-plugin `github-client.ts`
duplication, org-governance tool composition, or ruleset write support,
it would be the first to bear on this plugin specifically.
