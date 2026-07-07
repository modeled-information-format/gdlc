---
id: 1d8f5a3c-6e2b-4d9a-8f1c-3a7e5d2b9c46
type: procedural
created: 2026-07-07T00:00:00Z
namespace: github-sdlc-plugins/docs
modified: 2026-07-07T00:00:00Z
title: "How-to: onboard a new team with an org role"
diataxis_type: how-to
---

A new team just formed (a new product squad, a new on-call rotation) and
needs a specific level of org-wide access from day one — not "add them to
every repo one at a time," but a single org role that already carries the
permissions the team needs.

This assumes the team already exists and the org role you want to grant
already exists (this plugin doesn't create teams or roles — it only reads
and assigns/removes existing ones).

## Steps

1. **Find the role's numeric id.** Everything downstream keys off `roleId`,
   not the role's display name:

   ```text
   list_organization_roles { org: "octo-org" }
   ```

   Scan the result for the role you want (e.g. `"all_repo_read"` or a
   custom role your org defined) and note its `id`.

2. **Check who already holds it, so you know what you're adding the team
   into** — not strictly required, but worth doing before a permission
   change that affects a whole team at once:

   ```text
   list_role_teams { org: "octo-org", roleId: 8132 }
   ```

3. **Assign the role to the new team.** Pass the role id twice — once as
   `roleId`, once as `confirmRoleId` — the two must match exactly or the
   call fails before touching GitHub:

   ```text
   assign_team_role {
     org: "octo-org",
     roleId: 8132,
     confirmRoleId: 8132,
     teamSlug: "new-product-squad"
   }
   ```

4. **Confirm it took.** Re-run `list_role_teams` from step 2 — the new team
   should now be in the list. This isn't optional busywork: a
   `confirmation_mismatch` failure means nothing happened, but a real
   GitHub-side error partway through is also possible, so the only way to
   know the assignment actually landed is to check.

5. **If the team needs more than one role**, repeat steps 1 and 3 for each
   additional role — there's no bulk "assign these three roles at once"
   call, each is its own `assign_team_role` invocation.

## If you're assigning to a person instead of a team

The same pattern applies with `assign_user_role` /
`username` instead of `assign_team_role` / `teamSlug` — useful when
onboarding one new hire into a role rather than a whole team. See
[reference/tools.md](../reference/tools.md#assign_user_role) for the exact
parameters.

## Why the double role-id

Passing `roleId` and `confirmRoleId` might look redundant, but it's a
deliberate echo-guard against a copy-paste mistake granting the wrong role
org-wide — see
[explanation/org-identity-scope.md](../explanation/org-identity-scope.md)
for the reasoning. It's not asking you for a second, different
confirmation value; it's making sure the one you meant to type is the one
that actually gets sent.
