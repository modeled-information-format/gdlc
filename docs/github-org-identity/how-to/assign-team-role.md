---
id: 625e08b5-387b-4106-a7e6-b07a1ef662e4
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Assign an organization role to a team
diataxis_type: how-to
---
# Assign an organization role to a team

Use `assign_team_role` to grant an existing organization role to an
existing team. This is a write that mutates permissions across every repo
the role's definition covers — read
[the confirm-echo contract](../explanation/org-identity-scope.md#why-the-four-write-tools-echo-the-role-id)
before your first call if you haven't used one of this plugin's write tools
before.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission. This is a mutation — the
  identity needs write access to organization-roles, not just read.
- The numeric `roleId` (from [list_organization_roles](list-organization-roles.md))
  and the target team's `slug` (not its display name).
- This tool only assigns a role to a team that **already exists**. It does
  not create teams.

## Steps

1. Ask for the tool, passing the role id **twice** — once as `roleId`, once
   as `confirmRoleId` — plus the team's slug:

   > Use `assign_team_role` for org `my-org`, roleId `8132`, confirmRoleId
   > `8132`, teamSlug `my-team`.

   The two role-id fields must be identical. If they aren't, the call
   throws `confirmation_mismatch` before any GitHub API request is made —
   this is a deliberate guard, not a bug; retry with matching values once
   you've confirmed the `roleId` you meant to use.

2. On success you get back `{ "org": "my-org", "roleId": 8132, "teamSlug":
   "my-team" }`.

3. Confirm the assignment took effect with
   [list_role_teams](list-role-teams.md) — the team should now appear in
   that role's team list.

## If the call fails

- `confirmation_mismatch` — `roleId` and `confirmRoleId` didn't match; no
  API call was made. Retry with the same value in both fields.
- `missing_scope` — no resolvable token.
- `github_api_error` — the `roleId` or `teamSlug` doesn't exist, or the
  identity lacks org-roles write access.

## Next

[Remove the role again](remove-team-role.md) if you were experimenting, or
[assign the same role to a user](assign-user-role.md).
