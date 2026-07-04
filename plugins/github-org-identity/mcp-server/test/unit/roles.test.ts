import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import {
  listOrganizationRoles,
  listRoleTeams,
  listRoleUsers,
  assignTeamRole,
  removeTeamRole,
  assignUserRole,
  removeUserRole,
} from '../../src/tools/roles.js';

describe('listOrganizationRoles', () => {
  it('maps roles including custom ones with a null description', async () => {
    mockRest('get', '/orgs/acme/organization-roles', {
      total_count: 2,
      roles: [
        { id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', base_role: null },
        { id: 42, name: 'security-reviewer', description: null, source: 'Organization', base_role: 'read' },
      ],
    });
    const result = await listOrganizationRoles({ org: 'acme' });
    expect(result).toEqual([
      { id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', baseRole: null },
      { id: 42, name: 'security-reviewer', description: null, source: 'Organization', baseRole: 'read' },
    ]);
  });
});

describe('listRoleTeams', () => {
  it('maps the teams holding a role', async () => {
    mockRest('get', '/orgs/acme/organization-roles/42/teams', [{ slug: 'security', name: 'Security' }]);
    const result = await listRoleTeams({ org: 'acme', roleId: 42 });
    expect(result).toEqual([{ slug: 'security', name: 'Security' }]);
  });
});

describe('listRoleUsers', () => {
  it('maps users, defaulting a missing assignment to null', async () => {
    mockRest('get', '/orgs/acme/organization-roles/42/users', [
      { login: 'octocat', assignment: 'direct' },
      { login: 'hubot' },
    ]);
    const result = await listRoleUsers({ org: 'acme', roleId: 42 });
    expect(result).toEqual([
      { login: 'octocat', assignment: 'direct' },
      { login: 'hubot', assignment: null },
    ]);
  });
});

describe('assignTeamRole', () => {
  it('assigns the role when roleId and confirmRoleId match', async () => {
    mockRest('put', '/orgs/acme/organization-roles/teams/security/42', {}, 204);
    const result = await assignTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'security' });
    expect(result).toEqual({ org: 'acme', roleId: 42, teamSlug: 'security' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(assignTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 7, teamSlug: 'security' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
      details: { roleId: 42, confirmRoleId: 7 },
    });
  });
});

describe('removeTeamRole', () => {
  it('removes the role when roleId and confirmRoleId match', async () => {
    mockRest('delete', '/orgs/acme/organization-roles/teams/security/42', {}, 204);
    const result = await removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'security' });
    expect(result).toEqual({ org: 'acme', roleId: 42, teamSlug: 'security' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 7, teamSlug: 'security' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
  });
});

describe('assignUserRole', () => {
  it('assigns the role when roleId and confirmRoleId match', async () => {
    mockRest('put', '/orgs/acme/organization-roles/users/octocat/42', {}, 204);
    const result = await assignUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'octocat' });
    expect(result).toEqual({ org: 'acme', roleId: 42, username: 'octocat' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(assignUserRole({ org: 'acme', roleId: 42, confirmRoleId: 7, username: 'octocat' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
      details: { roleId: 42, confirmRoleId: 7 },
    });
  });
});

describe('removeUserRole', () => {
  it('removes the role when roleId and confirmRoleId match', async () => {
    mockRest('delete', '/orgs/acme/organization-roles/users/octocat/42', {}, 204);
    const result = await removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'octocat' });
    expect(result).toEqual({ org: 'acme', roleId: 42, username: 'octocat' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 7, username: 'octocat' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
  });
});
