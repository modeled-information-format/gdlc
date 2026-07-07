---
id: 7b2e9c4a-5f1d-4a8b-9c3e-6d2a8f4b1e57
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: run a periodic org-role access review"
diataxis_type: how-to
---

Compliance, security policy, or just good hygiene calls for a regular pass
over who holds which org-wide role — not inspecting one role you already
suspect is wrong, but sweeping every role to catch drift you didn't
already know about. That's the difference from
[the main tutorial](../tutorials/audit-and-assign-a-role.md), which walks
one role end to end; this is the same read tools, run across all of them.

## Steps

1. **List every role in the org first:**

   ```text
   list_organization_roles { org: "octo-org" }
   ```

   You get back both predefined roles (`source: "Predefined"`) and any
   custom roles your org defined (`source: "Organization"`). Review both —
   a custom role's `baseRole` tells you what permission floor it starts
   from, which matters when judging whether its membership looks right.

2. **For each role, pull both angles of who holds it.** Team-level:

   ```text
   list_role_teams { org: "octo-org", roleId: 8132 }
   ```

   And individual-level (direct or inherited through a team):

   ```text
   list_role_users { org: "octo-org", roleId: 8132 }
   ```

   Do both for every role in your list from step 1 — a role with no teams
   assigned might still have individual users holding it directly, and
   vice versa.

3. **Watch for `assignment: null` entries in the user list.** That means
   the underlying GitHub response didn't distinguish direct-vs-inherited
   for that entry — the tool reports that honestly instead of guessing. If
   you need to know whether a specific person holds a role directly or
   only through their team, a `null` here means you can't tell from this
   call alone; cross-reference against `list_role_teams` for that role to
   narrow it down.

4. **Flag anything surprising as you go** — a role held by a team that no
   longer matches its original purpose, a departed employee still showing
   up under `list_role_users`, a custom role nobody remembers the reason
   for. This plugin has no tool to explain *why* an assignment exists; that
   context has to come from your own records or from asking around.

5. **If you'd rather not call these seven tools by hand for every role**,
   the `org-role-audit` skill (mentioned in
   [the main tutorial](../tutorials/audit-and-assign-a-role.md)) runs the
   same read tools and presents a narrated summary — it never assigns or
   removes anything, so it's safe to run as often as you like for exactly
   this kind of sweep.

## After the review

This guide only covers the read side. If the review turns up a role that
needs to change — a team that's grown out of a role, a departed user still
holding one — the fix is `assign_team_role`/`remove_team_role` or
`assign_user_role`/`remove_user_role`; see
[onboard-a-new-team-with-an-org-role.md](onboard-a-new-team-with-an-org-role.md)
for the confirm-echo pattern those writes require.
