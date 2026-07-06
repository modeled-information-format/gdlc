---
id: b72d141d-7047-4b93-ae59-e3360786107d
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-repo-config tool reference
diataxis_type: reference
---

All 11 MCP tools registered by `plugins/github-repo-config/mcp-server/src/index.ts`,
in registration order. Every tool returns `{ content: [{ type: 'text', text: <JSON> }] }`
on success and `{ isError: true, content: [...] }` on failure; error bodies
carry `error` (one of `github_api_error`, `missing_scope`,
`confirmation_mismatch`), `message`, and any structured `details`.

## `get_branch_protection`

Read the current branch-protection config for a branch.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `branch` | `string` | yes |

Returns `{ requiredStatusChecks: { strict, contexts } \| null, enforceAdmins: boolean, requiredApprovingReviewCount: number \| null }`.

## `update_branch_protection`

Set the full branch-protection config for a branch (required status
checks, enforce-admins, required approving review count). GitHub requires
the full desired state in one call, not a partial patch — an omitted
field is not "leave as-is," it would silently disable that protection,
which is why all three fields below are required rather than optional.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `branch` | `string` | yes |
| `requiredStatusChecks` | `{ strict: boolean, contexts: string[] } \| null` | yes |
| `enforceAdmins` | `boolean` | yes |
| `requiredApprovingReviewCount` | `number \| null` | yes |

Returns the same shape as `get_branch_protection`. Sends `restrictions: null`
to GitHub internally (push restrictions aren't exposed as a tool input yet).

## `delete_branch_protection`

Remove all protection from a branch, opening its merge gate entirely.
Requires `confirmBranch` to equal `branch` — a mismatch throws
`confirmation_mismatch` before any API call is made.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `branch` | `string` | yes |
| `confirmBranch` | `string` | yes — must equal `branch` |

Returns `{ owner, repo, branch }`.

## `list_repo_rulesets`

List a repository's rulesets (the forward-compatible successor to branch
protection). Read-only.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |

Returns an array of `{ id, name, target, enforcement }`.

## `get_repo_ruleset`

Get a single ruleset by id, including its bypass actors. Read-only.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |
| `rulesetId` | `integer` | yes |

Returns `{ id, name, target, enforcement, bypassActors: [{ actorId, actorType, bypassMode }] }`.

## `list_org_health_files`

List default community health files/templates in the org's `.github`
repo — never `.github-private`.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `path` | `string` | no — directory path within the `.github` repo; empty/omitted lists the root |

Returns an array of `{ name, path, type: 'file' \| 'dir' }`.

## `get_org_health_file`

Read a default community health file's content from the org's `.github`
repo.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `path` | `string` | yes |

Returns `{ path, content }` — `content` is decoded from GitHub's base64
contents-API encoding to a UTF-8 string.

## `get_pages_config`

Read a repository's GitHub Pages configuration and status. Read-only.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |

Returns `{ url, status, buildType, htmlUrl }`.

## `list_custom_properties_schema`

List an org's custom repository-property definitions.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |

Returns an array of `{ propertyName, valueType, required: boolean }`.

## `get_repo_custom_properties`

Get a repository's custom property values.

| Parameter | Type | Required |
| --- | --- | --- |
| `owner` | `string` | yes |
| `repo` | `string` | yes |

Returns an array of `{ propertyName, value: string \| string[] \| null }`.

## `set_repo_custom_properties`

Bulk-set custom property values across the named repos in one org-level
write — can retarget ruleset enforcement across every named repo.
Requires `confirmRepoCount` to equal `repoNames.length` — a mismatch
throws `confirmation_mismatch` before any API call is made.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `repoNames` | `string[]` | yes |
| `properties` | `Array<{ propertyName: string, value: string \| string[] \| null }>` | yes |
| `confirmRepoCount` | `integer` | yes — must equal `repoNames.length` |

Returns `{ org, repoNames }`.
