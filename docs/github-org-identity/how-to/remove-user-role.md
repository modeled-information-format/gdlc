---
id: 65cc46a4-6c3e-4272-9769-45e32f443d80
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-08T00:00:00Z
title: Remove an organization role from a user
diataxis_type: how-to
---

Use `remove_user_role` to revoke an organization role a user currently
holds directly. Like the other write tools in this plugin, this mutates
permissions across every repo the role's definition covers — read
[the confirm-echo contract](../explanation/org-identity-scope.md#why-the-four-write-tools-echo-the-role-id)
before your first call if you haven't used one of this plugin's write tools
before.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission.
- The numeric `roleId` and the user's `username`. Confirm the user actually
  holds the role first with [list_role_users](list-role-users.md) — this
  tool does no pre-check of current state before calling the GitHub API.
- Note: if a user holds the role only through team membership (not a direct
  grant), this call targets the direct-assignment endpoint and will not
  remove a role that's only inherited via a team — remove it from the team
  instead with [remove_team_role](remove-team-role.md).

## Steps

1. Ask for the tool, passing the role id **twice** — once as `roleId`, once
   as `confirmRoleId` — plus the username:

   > Use `remove_user_role` for org `my-org`, roleId `8132`, confirmRoleId
   > `8132`, username `octocat`.

   The two role-id fields must be identical, or the call throws
   `confirmation_mismatch` before any GitHub API request is made.

2. On success you get back `{ "org": "my-org", "roleId": 8132, "username":
   "octocat" }`.

3. Confirm the removal took effect with
   [list_role_users](list-role-users.md) — the user should no longer appear
   as a direct holder of that role.

## If the call fails

- `confirmation_mismatch` — `roleId` and `confirmRoleId` didn't match; no
  API call was made.
- `missing_scope` — no resolvable token.
- `feature_unavailable` — the org's plan doesn't support organization
  roles (a GitHub Enterprise Cloud feature).
- `github_api_error` — the `roleId` doesn't exist, the `username` isn't an
  org member, or the identity lacks org-roles write access.

## Next

[Assign a role to a user](assign-user-role.md), or the equivalent
team-scoped tools: [assign_team_role](assign-team-role.md) /
[remove_team_role](remove-team-role.md).
