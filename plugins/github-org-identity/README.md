---
id: 8d0658b0-d832-4663-ac1f-95c4aa5bd686
type: semantic
created: 2026-07-04T00:00:00Z
namespace: github-sdlc-plugins/github-org-identity
modified: 2026-07-04T00:00:00Z
title: github-org-identity
diataxis_type: reference
---
# github-org-identity

Organization roles and teams: list an org's roles, list which teams/users
hold a role, and assign or remove a role for an existing team or user. Scoped
to the org-roles REST surface only — no team/org creation, no SAML/SSO.

## Install

```
/plugin marketplace add modeled-information-format/gdlc
/plugin install github-org-identity@github-sdlc-plugins
```

No dependency on the sibling planning plugins — this package is standalone
(pure REST, no GraphQL node-id resolution).

## Auth

Same token resolution as the sibling plugins (`GITHUB_TOKEN` env var, `gh
auth token` fallback). Organization-roles endpoints require the token's
identity to hold the org's `admin:org` scope (classic PAT) or an
App-installation token with the org-level `members`/`organization_administration`
permission — neither of this repo's existing five GitHub Apps currently grants
that (checked against `modeled-information-format/.github`'s
`auth/apps.json`), so live CI verification of this plugin's tools is not yet
wired (see "Live verification" below).

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_organization_roles` | List an org's predefined + custom organization roles |
| `list_role_teams` | List the teams holding a given role |
| `list_role_users` | List the users holding a given role, directly or via team |
| `assign_team_role` | Assign a role to a team |
| `remove_team_role` | Remove a role from a team |
| `assign_user_role` | Assign a role to a user |
| `remove_user_role` | Remove a role from a user |

## Confirm-echo contract on writes

`assign_team_role`, `remove_team_role`, `assign_user_role`, and
`remove_user_role` mutate org-wide permissions — a different risk class than
this marketplace's other tools (`create_issue`, `create_pull_request`, etc.),
which only touch a single issue/PR/project item. Each write tool requires the
target `roleId` twice, under two different field names: `roleId` and
`confirmRoleId`. If they don't match, the tool throws
`confirmation_mismatch` **before** making any API call. This is a deliberate,
lightweight guard against a single accidental or hallucinated invocation
mutating org permissions — not a heavier approval workflow, and not a
guarantee against a caller who deliberately passes matching values without
meaning to.

## Error codes

Every tool throws a structured `OrgIdentityError` with one of four codes:

| Code | Meaning |
| --- | --- |
| `missing_scope` | No GitHub token available. |
| `confirmation_mismatch` | A write tool's `roleId`/`confirmRoleId` echo didn't match — see above. |
| `feature_unavailable` | Organization roles are a GitHub Enterprise Cloud feature; the org's plan doesn't support them (or a definite plan name confirms it isn't Enterprise Cloud). |
| `github_api_error` | Any other non-OK response from the GitHub API, including a 404/403 when the org's plan can't be determined from the resolved identity (see "Auth" above) but the org genuinely doesn't support organization roles. |

## Skill

- `org-role-audit` — lists organization roles and their team/user
  assignments and presents a summary for a human to review. Read-only: it
  surfaces findings, it does not act on them.

## Scope boundary

This plugin covers organization-roles REST endpoints only: role discovery
and role assignment to *existing* teams/users. Out of scope, deliberately:

- **SAML/SSO** — Enterprise Cloud-only, and IdP-synced teams explicitly
  refuse API membership changes per GitHub's own docs. Not automatable, and
  `modeled-information-format` is not confirmed to be an Enterprise Cloud
  org, so even a read-only inspection tool would be untestable here.
- **Team/org membership creation** (`POST /orgs/{org}/teams`, member
  invitation) — a different REST domain than organization-roles; not built.
- **Automated remediation** in `org-role-audit` — it presents an audit
  summary, it never changes a role assignment on its own.

## Live verification

`scripts/verify-live.ts` exercises the three read tools
(`list_organization_roles`, `list_role_teams`, `list_role_users`) against a
real org when run manually with a token that has org-roles read access. It
is **not** wired into `.github/workflows/live-integration-tests.yml` yet —
none of this repo's five GitHub Apps hold the org-level permission
organization-roles endpoints require. Extending an App's permissions (or
provisioning a new one) is a separate, cross-repo change against
`modeled-information-format/.github`'s `auth/apps.json`, tracked as a
follow-up rather than bundled into this plugin.
