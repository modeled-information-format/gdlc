---
id: 34b5d3a9-2410-40a3-9a12-57f17421837e
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-packages tool reference
diataxis_type: reference
---

Exhaustive listing of the 8 MCP tools `github-packages` registers, pulled
directly from `plugins/github-packages/mcp-server/src/index.ts` and
`mcp-server/src/tools/packages.ts`. All inputs use `packageType`, an enum of
`npm`, `maven`, `rubygems`, `docker`, `container`, `nuget`, `generic`.
`docker` and `container` are distinct: `docker` targets the legacy
`docker.pkg.github.com` registry, `container` targets `ghcr.io`.

## `list_org_packages`

List an org's packages of a given package type. GitHub's real endpoint
requires `package_type` — there is no single call that lists every type at
once.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum (`npm`\|`maven`\|`rubygems`\|`docker`\|`container`\|`nuget`\|`generic`) | yes |

Returns an array of `{ id, name, packageType, visibility, versionCount }`.

## `get_org_package`

Get a single package by name and type.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |

Returns `{ id, name, packageType, visibility, versionCount }`.

## `list_package_versions`

List the versions of a package.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |

Returns an array of `{ id, name, createdAt }`.

## `get_package_version`

Get a single package version by id.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |
| `versionId` | integer | yes |

Returns `{ id, name, createdAt }`.

## `delete_package`

Delete an entire package. Restorable only within GitHub's ~30-day window and
only if nothing has since republished under the same name. Requires
`confirmPackageName` to equal `packageName`; a mismatch throws
`confirmation_mismatch` before any API call is made.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |
| `confirmPackageName` | string | yes — must equal `packageName` |

Returns `{ org, packageType, packageName }`.

## `delete_package_version`

Delete a single package version. Restorable only within GitHub's ~30-day
window and only if nothing has since republished under the same version.
Requires `confirmVersionId` to equal `versionId`; a mismatch throws
`confirmation_mismatch` before any API call is made.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |
| `versionId` | integer | yes |
| `confirmVersionId` | integer | yes — must equal `versionId` |

Returns `{ org, packageType, packageName, versionId }`.

## `restore_package`

Restore a deleted package, within GitHub's ~30-day window. No confirm-echo
guard: restoring undoes a delete rather than causing new loss.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |

Returns `{ org, packageType, packageName }`.

## `restore_package_version`

Restore a deleted package version, within GitHub's ~30-day window.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | string | yes |
| `packageType` | enum | yes |
| `packageName` | string | yes |
| `versionId` | integer | yes |

Returns `{ org, packageType, packageName, versionId }`.

## Error shapes

All tools return `{ isError: true, content: [...] }` on failure. Structured
errors (`PackagesError`, `mcp-server/src/errors.ts`) carry one of three
codes: `github_api_error`, `missing_scope`, `confirmation_mismatch`.
Unstructured failures (e.g. a raw network error) surface as
`{ error: 'github_api_error', message }`.
