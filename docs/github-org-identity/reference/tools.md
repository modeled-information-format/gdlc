---
id: f8324566-2155-4df6-a09c-afda2d725cc6
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: github-org-identity MCP tools
diataxis_type: reference
---

Seven tools, registered in
[`mcp-server/src/index.ts`](../../../plugins/github-org-identity/mcp-server/src/index.ts),
implemented in
[`mcp-server/src/tools/roles.ts`](../../../plugins/github-org-identity/mcp-server/src/tools/roles.ts).
All operate on GitHub's organization-roles REST surface
(`/orgs/{org}/organization-roles/...`). Three are read-only; four mutate
org-wide permissions and share a confirm-echo contract (see below).

## Read tools

### `list_organization_roles`

List an org's predefined and custom organization roles.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |

Returns an array of `{ id, name, description, source, baseRole }`.

### `list_role_teams`

List the teams holding a given organization role.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |

Returns an array of `{ slug, name }`.

### `list_role_users`

List the users holding a given organization role, directly or via team
membership.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |

Returns an array of `{ login, assignment }`. `assignment` is `null` when the
underlying GitHub API response omits the field (older API responses),
rather than being assumed `"direct"`.

## Write tools

Each write tool mutates org-wide permissions and requires the target
`roleId` twice, under two different field names: `roleId` and
`confirmRoleId`. If the two values don't match, the call throws
`confirmation_mismatch` before any GitHub API request is made. See
[explanation/org-identity-scope.md](../explanation/org-identity-scope.md)
for why this exists.

### `assign_team_role`

Assign an organization role to a team.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |
| `confirmRoleId` | `number` (integer) | yes — must equal `roleId` |
| `teamSlug` | `string` | yes |

Returns `{ org, roleId, teamSlug }` on success (`PUT` to
`/orgs/{org}/organization-roles/teams/{teamSlug}/{roleId}`).

### `remove_team_role`

Remove an organization role from a team.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |
| `confirmRoleId` | `number` (integer) | yes — must equal `roleId` |
| `teamSlug` | `string` | yes |

Returns `{ org, roleId, teamSlug }` on success (`DELETE` to
`/orgs/{org}/organization-roles/teams/{teamSlug}/{roleId}`).

### `assign_user_role`

Assign an organization role to a user.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |
| `confirmRoleId` | `number` (integer) | yes — must equal `roleId` |
| `username` | `string` | yes |

Returns `{ org, roleId, username }` on success (`PUT` to
`/orgs/{org}/organization-roles/users/{username}/{roleId}`).

### `remove_user_role`

Remove an organization role from a user.

| Parameter | Type | Required |
| --- | --- | --- |
| `org` | `string` | yes |
| `roleId` | `number` (integer) | yes |
| `confirmRoleId` | `number` (integer) | yes — must equal `roleId` |
| `username` | `string` | yes |

Returns `{ org, roleId, username }` on success (`DELETE` to
`/orgs/{org}/organization-roles/users/{username}/{roleId}`).

## Errors

On failure, a tool returns either a structured `OrgIdentityError` with one
of three codes — `github_api_error` (any non-2xx GitHub response, status
included), `missing_scope` (no resolvable `GITHUB_TOKEN`/`gh auth token`),
or `confirmation_mismatch` (write tools only, `roleId` != `confirmRoleId`)
— or, for an error that isn't an `OrgIdentityError` instance (an
unclassified failure that escaped typing), the generic fallback
`{ error: "github_api_error", message }`.
