---
id: 73a7b3ee-249b-483f-8484-368b35860414
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List the users holding an organization role
diataxis_type: how-to
---

Use `list_role_users` to see which individual users currently hold a given
organization role, whether granted directly or inherited through team
membership.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission.
- The numeric `roleId` you want to inspect — get it from
  [list_organization_roles](list-organization-roles.md) first if you don't
  already have it.

## Steps

1. Ask for the tool with the org and the role's numeric id:

   > Use `list_role_users` for org `my-org`, roleId `8132`.

2. Read the result — an array of `{ "login": "...", "assignment": "..." }`.

   `assignment` reflects how the user holds the role. Treat a `null` value
   as **unknown**, not as "direct" — the tool reports `null` rather than
   guessing whenever the underlying GitHub API response omits the field
   (this happens on older API responses).

## If the call fails

- `missing_scope` — no resolvable token.
- `github_api_error` — the `roleId` doesn't exist in this org, or the
  identity lacks org-roles read access.

## Next

- [Assign this role to a user](assign-user-role.md)
- [List the teams holding this role](list-role-teams.md)
