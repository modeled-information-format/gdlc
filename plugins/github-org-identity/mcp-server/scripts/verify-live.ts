#!/usr/bin/env tsx
/**
 * Live verification script: exercises the real src/ implementation against
 * a real GitHub org, not a mock. Not part of the CI-gating `npm test` suite
 * — invoked manually with a token that has org-roles read access
 * (`gh auth login --scopes admin:org` or a suitably-permissioned token in
 * GITHUB_TOKEN).
 *
 * READ-ONLY BY DESIGN: only the three list_* tools are exercised here.
 * assign_team_role/remove_team_role/assign_user_role/remove_user_role are
 * NOT exercised against a real org by this script or by any CI workflow —
 * none of this repo's five GitHub Apps hold the org-level
 * members/organization_administration permission organization-roles writes
 * require (checked against modeled-information-format/.github's
 * auth/apps.json), and a real assign/remove call mutates production org
 * permissions. Write-path coverage lives entirely in the mocked unit
 * suite (test/unit/roles.test.ts); a real write is a manual,
 * human-supervised step, not something this script automates.
 *
 * Sequence: list_organization_roles -> list_role_teams -> list_role_users
 * (for the first role that has at least one team or user assignment, if
 * any — an org with zero custom role assignments is a valid, if less
 * informative, run).
 *
 * TARGET_ORG, not a "sandbox" var: unlike the sibling plugins' SANDBOX_REPO
 * (a disposable repo), organization roles are an org-wide construct with no
 * sandboxable equivalent — this script is read-only by design instead, so
 * defaulting to the real org is the intended usage, not an accidental
 * production target the name should obscure.
 */
import { listOrganizationRoles, listRoleTeams, listRoleUsers } from '../src/tools/roles.js';

const ORG = process.env.TARGET_ORG ?? 'modeled-information-format';

let failed = false;
function assert(condition: boolean, message: string): void {
  if (condition) {
    process.stdout.write(`  OK   ${message}\n`);
  } else {
    failed = true;
    process.stdout.write(`  FAIL ${message}\n`);
  }
}
function step(name: string): void {
  process.stdout.write(`\n=== ${name} ===\n`);
}

async function main(): Promise<void> {
  step('list_organization_roles');
  const roles = await listOrganizationRoles({ org: ORG });
  assert(Array.isArray(roles), `list_organization_roles returned an array (${roles.length} role(s))`);

  const role = roles[0];
  if (role === undefined) {
    process.stdout.write('\n=== list_role_teams / list_role_users ===\n  SKIP (org has no organization roles to inspect)\n');
  } else {
    step(`list_role_teams (role: ${role.name}, id ${role.id})`);
    const teams = await listRoleTeams({ org: ORG, roleId: role.id });
    assert(Array.isArray(teams), `list_role_teams returned an array (${teams.length} team(s))`);

    step(`list_role_users (role: ${role.name}, id ${role.id})`);
    const users = await listRoleUsers({ org: ORG, roleId: role.id });
    assert(Array.isArray(users), `list_role_users returned an array (${users.length} user(s))`);
  }

  if (failed) {
    process.stdout.write('\nverify-live: FAILED\n');
    process.exit(1);
  }
  process.stdout.write('\nverify-live: PASSED\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`verify-live crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
