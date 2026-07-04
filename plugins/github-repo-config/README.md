---
id: d28216af-48cd-4d86-9d1d-010ce39c4894
type: semantic
created: 2026-07-04T00:00:00Z
namespace: github-sdlc-plugins/github-repo-config
modified: 2026-07-04T00:00:00Z
title: github-repo-config
diataxis_type: reference
---
# github-repo-config

Repo/org governance surfaces, deliberately scoped to what's mature and
GA: branch protection and rulesets, org-wide `.github` community health
files, GitHub Pages status, and custom repository properties. Not a
planning surface — this is the "deferred" Tier-3 domain #3 (repo/org
configuration), scoped narrowly per its own finding.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-repo-config@github-sdlc-plugins
```

No dependency on the sibling plugins — standalone, pure REST.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `get_branch_protection` | Read a branch's protection config |
| `update_branch_protection` | Set the full protection config (GitHub requires the full desired state per call, not a partial patch) |
| `delete_branch_protection` | Remove all protection from a branch — requires `confirmBranch` to equal `branch` |
| `list_repo_rulesets` / `get_repo_ruleset` | Read-only: the forward-compatible successor to branch protection (multiple named rulesets per branch/tag pattern) |
| `list_org_health_files` / `get_org_health_file` | Read default community health templates from the org's `.github` repo — never `.github-private`, which is a separate internal-tooling repo not consulted for these defaults |
| `get_pages_config` | Read-only Pages status/build-type for a repo |
| `list_custom_properties_schema` | List an org's custom repository-property definitions |
| `get_repo_custom_properties` | Get a repo's custom property values |
| `set_repo_custom_properties` | Bulk-set values across named repos — requires `confirmRepoCount` to equal `repoNames.length` |

## Confirm-echo contract on writes

`delete_branch_protection` and `set_repo_custom_properties` mutate
broader-than-single-item state — removing all protection from a branch
opens its merge gate entirely, and bulk property writes can retarget
ruleset enforcement across every named repo at once. Each requires an
echoed confirmation value (`confirmBranch`/`confirmRepoCount`) that must
match the primary input, or the tool throws `confirmation_mismatch`
**before** making any API call. `update_branch_protection` does not carry
this guard: GitHub's PUT endpoint requires the caller to state the full
desired state in one call, so there's no "silently cleared a field you
didn't mention" risk the way a partial PATCH would have.

## Scope boundary

Rulesets are read-only in this pass — write support (create/update/delete
a ruleset) needs its own confirm-echo design given the same broad-blast-radius
risk as branch protection, deliberately deferred rather than rushed
alongside branch-protection's write tools. GitHub Pages is read-only
entirely: enabling/disabling a repo's live site is a real risk this
plugin doesn't take on for a domain its own finding already calls
orthogonal to planning. `.github-private` is never targeted by
`list_org_health_files`/`get_org_health_file` — only the public `.github`
repo, which is what GitHub actually reads for org-wide defaults.

## Live verification

`scripts/verify-live.ts` exercises the read tools against a real
org/repo (defaults to `modeled-information-format`/`gdlc`). Run
manually — the three write tools (`update_branch_protection`,
`delete_branch_protection`, `set_repo_custom_properties`) are covered
only by the mocked unit suite, never against a real repo/org.
