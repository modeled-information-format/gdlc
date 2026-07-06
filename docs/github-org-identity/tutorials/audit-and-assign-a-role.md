---
id: 82eb2142-e9d2-4006-8f2c-47ed313631e8
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Audit an org's roles, then assign and remove one
diataxis_type: tutorial
---

This walkthrough takes you from "what roles does this org even have" through
to assigning a role to a team and then removing it again — the full
read-then-write cycle `github-org-identity` supports. By the end you'll have
seen every one of the plugin's seven tools in action at least once.

You'll need `github-org-identity` installed
(`/plugin install github-org-identity@github-sdlc-plugins`) and a GitHub
token with the org's `admin:org` scope (a classic PAT, resolved via
`GITHUB_TOKEN` or `gh auth token` — see
[explanation/org-identity-scope.md](../explanation/org-identity-scope.md)
for why the plugin's own bundled GitHub Apps can't grant this yet). You'll
also need a team slug in the org you're willing to experiment on — this
tutorial assigns and then removes a role, so pick a team where a brief,
reversed permission change is safe.

## 1. See what roles the org has

Ask Claude to call `list_organization_roles` with your org's login, e.g.:

> Use `list_organization_roles` for org `my-org`.

You'll get back an array like:

```json
[
  { "id": 8132, "name": "all_repo_read", "description": "View all repositories", "source": "Predefined", "baseRole": null },
  { "id": 143221, "name": "Security auditor", "description": "Custom security role", "source": "Organization", "baseRole": "security_manager" }
]
```

Note the `id` of a role you want to inspect next — everything downstream
keys off this numeric `roleId`, not the role's name.

## 2. See who already holds that role

Two tools answer this from different angles. `list_role_teams` shows which
teams hold the role directly:

> Use `list_role_teams` for org `my-org`, roleId `8132`.

`list_role_users` shows individual users, whether they hold the role
directly or inherited it through a team:

> Use `list_role_users` for org `my-org`, roleId `8132`.

In the result, an `assignment` of `null` means the underlying GitHub
response didn't distinguish direct-vs-inherited for that entry — the tool
reports that honestly rather than guessing "direct."

If you'd rather get a narrated summary instead of raw tool output, the
`org-role-audit` skill runs these same read tools and presents the findings
for you to review — it never assigns or removes anything itself.

## 3. Assign the role to a team

This is a write, so it mutates org-wide permissions the moment it succeeds.
Pick a team slug you're comfortable changing temporarily, and pass the
`roleId` **twice** — once as `roleId`, once as `confirmRoleId`:

> Use `assign_team_role` for org `my-org`, roleId `8132`, confirmRoleId
> `8132`, teamSlug `my-team`.

If the two role-id fields don't match, the call fails immediately with
`confirmation_mismatch` and never reaches GitHub — that's intentional; see
[explanation/org-identity-scope.md](../explanation/org-identity-scope.md#why-the-four-write-tools-echo-the-role-id).
On success you get back `{ "org": "my-org", "roleId": 8132, "teamSlug":
"my-team" }`.

Confirm it took effect by re-running `list_role_teams` from step 2 — your
team should now appear.

## 4. Remove the role again

Reverse the change the same way, with `remove_team_role`:

> Use `remove_team_role` for org `my-org`, roleId `8132`, confirmRoleId
> `8132`, teamSlug `my-team`.

Re-run `list_role_teams` once more to confirm the team is gone from the
list.

## What you've done

You've listed an org's roles, inspected role membership from both the team
and user angle, and performed a confirmed assign/remove cycle — the same
four-tool write pattern applies identically to `assign_user_role` /
`remove_user_role`, just keyed by `username` instead of `teamSlug`. For a
recipe-style reference to any single one of these seven tools, see the
[how-to guides](../how-to/); for the full parameter tables, see
[reference/tools.md](../reference/tools.md).
