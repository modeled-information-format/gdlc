---
id: c800e9b4-aab1-4f78-a364-1c3ab31d768b
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Assign an organization role to a user
diataxis_type: how-to
---
# Assign an organization role to a user

Use `assign_user_role` to grant an existing organization role directly to
an existing org member. This is a write that mutates permissions across
every repo the role's definition covers — read
[the confirm-echo contract](../explanation/org-identity-scope.md#why-the-four-write-tools-echo-the-role-id)
before your first call if you haven't used one of this plugin's write tools
before.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission.
- The numeric `roleId` (from [list_organization_roles](list-organization-roles.md))
  and the target's `username`.
- This tool only assigns a role to a user who is **already an org member**.
  It does not invite users into the org.

## Steps

1. Ask for the tool, passing the role id **twice** — once as `roleId`, once
   as `confirmRoleId` — plus the target username:

   > Use `assign_user_role` for org `my-org`, roleId `8132`, confirmRoleId
   > `8132`, username `octocat`.

   The two role-id fields must be identical. If they aren't, the call
   throws `confirmation_mismatch` before any GitHub API request is made —
   retry with matching values once you've confirmed the `roleId` you meant.

2. On success you get back `{ "org": "my-org", "roleId": 8132, "username":
   "octocat" }`.

3. Confirm the assignment took effect with
   [list_role_users](list-role-users.md) — the user should now appear in
   that role's user list, with `assignment` reflecting a direct grant.

## If the call fails

- `confirmation_mismatch` — `roleId` and `confirmRoleId` didn't match; no
  API call was made.
- `missing_scope` — no resolvable token.
- `github_api_error` — the `roleId` doesn't exist, the `username` isn't an
  org member, or the identity lacks org-roles write access.

## Next

[Remove the role again](remove-user-role.md) if you were experimenting, or
[assign the same role to a team](assign-team-role.md).
