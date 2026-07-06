---
id: d55a158c-2fdd-4c78-bb3f-6fda97087ed6
type: procedural
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: List an org's organization roles
diataxis_type: how-to
---
# List an org's organization roles

Use `list_organization_roles` to see every predefined and custom
organization role an org has defined, before looking up who holds any of
them.

## Prerequisites

- `github-org-identity` installed.
- A GitHub token (`GITHUB_TOKEN` env var, or `gh auth token` fallback) whose
  identity holds the org's `admin:org` scope (classic PAT) or an
  App-installation token with the org-level `members`/
  `organization_administration` permission. This is a read call, but the
  organization-roles endpoint requires the same scope for reads as writes.

## Steps

1. Ask for the tool with the org's login:

   > Use `list_organization_roles` for org `my-org`.

2. Read the result — an array of:

   ```json
   { "id": 8132, "name": "all_repo_read", "description": "View all repositories", "source": "Predefined", "baseRole": null }
   ```

   `source` distinguishes GitHub's predefined roles from ones the org
   defined itself (`Organization`). `baseRole` is set only when a custom
   role was built on top of a predefined base.

3. Note the `id` of any role you want to inspect further — it's the
   `roleId` every other tool in this plugin takes, not the role's `name`.

## If the call fails

- `missing_scope` — no resolvable token. Set `GITHUB_TOKEN`, or run
  `gh auth login --scopes admin:org`.
- `github_api_error` with a 403/404 — the resolved identity doesn't have
  org-roles read access, or the org login is wrong.

## Next

[List which teams or users hold a specific role](list-role-teams.md).
