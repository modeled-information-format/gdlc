---
id: 54d3fbcc-8441-4b2e-820c-814e043c6d58
type: semantic
created: 2026-07-05T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-05T00:00:00Z
title: Why github-org-identity exists, and what it deliberately doesn't do
diataxis_type: explanation
---
# Why github-org-identity exists, and what it deliberately doesn't do

## The domain: org-level roles, not repo-level access

GitHub separates permission into two distinct planes. `github-repo-config`
(a sibling plugin in this marketplace) governs **repo-level** access:
branch protection, rulesets, custom properties — settings that apply to one
repository. `github-org-identity` governs a different plane entirely:
**organization roles**, GitHub's mechanism for granting an org-wide
capability (e.g. "manage security settings for every repo in the org," "view
all private repos") to a team or a user, independent of any single
repository's own collaborator list.

An organization role is not a repo permission and not a team's repository
access level. It's closer to an org-scoped RBAC assignment: a named role
(predefined by GitHub, or custom to the org) that a team or user holds, which
then applies across the org's repos according to that role's definition.
`github-org-identity` covers exactly this surface — discovering which roles
an org has, seeing who holds a role, and assigning or removing a role for an
*existing* team or user.

## What's deliberately out of scope

The plugin's [README](../../../plugins/github-org-identity/README.md) draws
three boundaries, and the source confirms none of them are implemented:

- **SAML/SSO** — Enterprise Cloud-only, and IdP-synced teams refuse API
  membership changes per GitHub's own docs. Not automatable in general, and
  `modeled-information-format` is not confirmed to be an Enterprise Cloud
  org, so even a read-only inspection tool would be untestable here.
- **Team/org membership creation** — creating a team, or inviting a user
  into the org in the first place, is a different REST domain
  (`POST /orgs/{org}/teams`, member invitation) than organization-roles.
  `github-org-identity` only assigns roles to teams/users that already
  exist; it has no tool that creates either.
- **Automated remediation** — the plugin's `org-role-audit` skill (see the
  [tutorial](../tutorials/audit-and-assign-a-role.md)) presents an audit
  summary of who holds what; it never changes a role assignment on its own.
  Every mutation in this plugin is a deliberate, individually confirmed tool
  call.

This is why the plugin has no `dependencies` entry on any sibling
plugin (confirmed in `.claude-plugin/plugin.json`): it's a pure REST
integration against `/orgs/{org}/organization-roles/*`, with no GraphQL
node-id resolution and nothing to compose with `github-sdlc-planning`'s or
`github-pull-requests`' MIF/Projects-v2 machinery.

## Why the four write tools echo the role ID

`assign_team_role`, `remove_team_role`, `assign_user_role`, and
`remove_user_role` each require the target `roleId` twice — once as
`roleId`, once as `confirmRoleId` — and refuse the call before touching the
GitHub API if the two don't match. The source comment in
[`roles.ts`](../../../plugins/github-org-identity/mcp-server/src/tools/roles.ts)
is explicit about why: assigning or removing an org role is a different risk
class than this marketplace's other mutating tools (`create_issue`,
`create_pull_request`, and similar), which only ever touch a single
issue, PR, or project item. An org-role mutation changes what a team or
user can do across *every* repo in the org. The two-field echo is a
deliberate, lightweight guard against a single accidental or hallucinated
invocation — not a heavier approval workflow, and not a guarantee against a
caller that deliberately (but mistakenly) passes matching values.

## Audit finding: no ADR governs this plugin

This repository's three accepted ADRs
([0001](../../decisions/adr-0001-bug-capture-layer1-core.md),
[0002](../../decisions/adr-0002-pr-issue-linkage-ownership.md),
[0003](../../decisions/adr-0003-board-status-hygiene.md)) were read in full
for this audit. All three concern `github-bug-capture`'s Layer 1
architecture, the PR-to-issue linkage boundary between `github-pull-requests`
and `github-bug-capture`, and Projects v2 board-status automation in
`github-sdlc-planning`. None reference organization roles, teams, or
`github-org-identity`, and none of their decision text, consequences, or
audit sections apply to this plugin's scope. This plugin is, and remains,
standalone with respect to every decision this repository has recorded.

## Why live CI verification isn't wired up yet

`scripts/verify-live.ts` exercises the three read tools against a real org,
but it isn't wired into `.github/workflows/live-integration-tests.yml`.
Organization-roles endpoints require the calling identity to hold the org's
`admin:org` scope (classic PAT) or an App-installation token with the
org-level `members`/`organization_administration` permission. None of this
repo's five GitHub Apps (as of this writing) grant that permission — see
`modeled-information-format/.github`'s `auth/apps.json`. Extending an App's
permissions, or provisioning a new one, is a cross-repo change tracked as a
follow-up rather than bundled into this plugin.
