---
id: 6bef7c63-9060-4566-8879-5bb22cd5910b
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List the teams holding an organization role
diataxis_type: how-to
---

Use `list_role_teams` to see which teams currently hold a given
organization role — the team-level counterpart to `list_role_users`.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission.
- The numeric `roleId` you want to inspect — get it from
  [list_organization_roles](list-organization-roles.md) first if you don't
  already have it; this tool does not accept a role name.

## Steps

1. Ask for the tool with the org and the role's numeric id:

   > Use `list_role_teams` for org `my-org`, roleId `8132`.

2. Read the result — an array of `{ "slug": "...", "name": "..." }` for
   every team directly holding that role. An empty array means no team
   currently holds it (individual users might still hold it directly — see
   [list_role_users](list-role-users.md)).

## If the call fails

- `missing_scope` — no resolvable token.
- `github_api_error` — the `roleId` doesn't exist in this org, or the
  identity lacks org-roles read access.

## Next

- [Assign this role to a team](assign-team-role.md)
- [List the users holding this role](list-role-users.md)
