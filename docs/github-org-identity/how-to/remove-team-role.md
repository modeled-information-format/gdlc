---
id: aa42c86c-624d-417e-85d5-aaaa7ec39b2d
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-08T00:00:00Z
title: Remove an organization role from a team
diataxis_type: how-to
---

Use `remove_team_role` to revoke an organization role a team currently
holds. Like the other write tools in this plugin, this mutates permissions
across every repo the role's definition covers — read
[the confirm-echo contract](../explanation/org-identity-scope.md#why-the-four-write-tools-echo-the-role-id)
before your first call if you haven't used one of this plugin's write tools
before.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token resolvable via `GITHUB_TOKEN` or `gh auth token`, with the
  org's `admin:org` scope or App-installation `members`/
  `organization_administration` permission.
- The numeric `roleId` and the team's `slug`. Confirm the team actually
  holds the role first with [list_role_teams](list-role-teams.md) — removing
  a role a team doesn't hold still reaches the GitHub API and its response
  governs the outcome, this tool does no pre-check of current state.

## Steps

1. Ask for the tool, passing the role id **twice** — once as `roleId`, once
   as `confirmRoleId` — plus the team's slug:

   > Use `remove_team_role` for org `my-org`, roleId `8132`, confirmRoleId
   > `8132`, teamSlug `my-team`.

   The two role-id fields must be identical, or the call throws
   `confirmation_mismatch` before any GitHub API request is made.

2. On success you get back `{ "org": "my-org", "roleId": 8132, "teamSlug":
   "my-team" }`.

3. Confirm the removal took effect with
   [list_role_teams](list-role-teams.md) — the team should no longer appear
   in that role's team list.

## If the call fails

- `confirmation_mismatch` — `roleId` and `confirmRoleId` didn't match; no
  API call was made.
- `missing_scope` — no resolvable token.
- `feature_unavailable` — the org's plan doesn't support organization
  roles (a GitHub Enterprise Cloud feature).
- `github_api_error` — the `roleId` or `teamSlug` doesn't exist, or the
  identity lacks org-roles write access.

## Next

[Assign a role to a team](assign-team-role.md), or the equivalent user-scoped
tools: [assign_user_role](assign-user-role.md) /
[remove_user_role](remove-user-role.md).
