import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mockRest } from '../helpers.js';
import { server } from '../setup.js';
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
  it('maps roles including custom ones with a null description on an Enterprise-plan org', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
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

  it('throws feature_unavailable for a free-plan org without calling the organization-roles endpoint', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    mockRest('get', '/orgs/acme/organization-roles', { message: 'Not Found' }, 404);
    await expect(listOrganizationRoles({ org: 'acme' })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('falls through to the real endpoint (and succeeds) when the org response has no plan field, since a missing plan is indeterminate rather than a negative signal -- e.g. an App-installation token without the separate Organization-plan permission, or a non-owner admin:org holder, on an org that is actually Enterprise Cloud', async () => {
    mockRest('get', '/orgs/acme', {});
    mockRest('get', '/orgs/acme/organization-roles', {
      total_count: 1,
      roles: [{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', base_role: null }],
    });
    const result = await listOrganizationRoles({ org: 'acme' });
    expect(result).toEqual([{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', baseRole: null }]);
  });

  it('surfaces the real endpoint 404 as github_api_error (not feature_unavailable) when the plan is indeterminate and the org genuinely does not support organization roles', async () => {
    mockRest('get', '/orgs/acme', {});
    mockRest('get', '/orgs/acme/organization-roles', { message: 'Not Found' }, 404);
    await expect(listOrganizationRoles({ org: 'acme' })).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('treats an explicit null plan name as indeterminate, not as a definite rejection', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: null } });
    mockRest('get', '/orgs/acme/organization-roles', {
      total_count: 1,
      roles: [{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', base_role: null }],
    });
    const result = await listOrganizationRoles({ org: 'acme' });
    expect(result).toEqual([{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', baseRole: null }]);
  });

  it('treats an unrecognized plan name as indeterminate rather than rejecting, so an unknown/renamed tier falls through to the real endpoint instead of a false rejection', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'some-future-tier' } });
    mockRest('get', '/orgs/acme/organization-roles', {
      total_count: 1,
      roles: [{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', base_role: null }],
    });
    const result = await listOrganizationRoles({ org: 'acme' });
    expect(result).toEqual([{ id: 1, name: 'all_repo_admin', description: 'Admin on every repo', source: 'Predefined', baseRole: null }]);
  });

  it('still rejects the other two known-unsupported plan tiers (team, business), not just free', async () => {
    for (const plan of ['team', 'business']) {
      mockRest('get', '/orgs/acme', { plan: { name: plan } });
      // A rejection self-evicts from the cache on settlement (see the cache
      // doc comment above), so each loop iteration re-checks for real
      // rather than reusing a stale cached verdict from the prior plan.
      await expect(listOrganizationRoles({ org: 'acme' })).rejects.toMatchObject({
        code: 'feature_unavailable',
        details: { org: 'acme', plan },
      });
    }
  });
});

describe('listRoleTeams', () => {
  it('maps the teams holding a role', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('get', '/orgs/acme/organization-roles/42/teams', [{ slug: 'security', name: 'Security' }]);
    const result = await listRoleTeams({ org: 'acme', roleId: 42 });
    expect(result).toEqual([{ slug: 'security', name: 'Security' }]);
  });

  it('throws feature_unavailable for a free-plan org without calling the teams endpoint', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(listRoleTeams({ org: 'acme', roleId: 42 })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('does not re-check the org plan on a second guarded call for the same org', async () => {
    let orgCalls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme', () => {
        orgCalls += 1;
        return HttpResponse.json({ plan: { name: 'enterprise' } });
      }),
    );
    mockRest('get', '/orgs/acme/organization-roles/42/teams', [{ slug: 'security', name: 'Security' }]);
    mockRest('get', '/orgs/acme/organization-roles/42/users', [{ login: 'octocat', assignment: 'direct' }]);
    await listRoleTeams({ org: 'acme', roleId: 42 });
    await listRoleUsers({ org: 'acme', roleId: 42 });
    expect(orgCalls).toBe(1);
  });

  it('dedupes concurrent guarded calls for the same not-yet-checked org into a single org-plan request', async () => {
    let orgCalls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme', () => {
        orgCalls += 1;
        return HttpResponse.json({ plan: { name: 'enterprise' } });
      }),
    );
    mockRest('get', '/orgs/acme/organization-roles/42/teams', [{ slug: 'security', name: 'Security' }]);
    mockRest('get', '/orgs/acme/organization-roles/42/users', [{ login: 'octocat', assignment: 'direct' }]);
    await Promise.all([listRoleTeams({ org: 'acme', roleId: 42 }), listRoleUsers({ org: 'acme', roleId: 42 })]);
    expect(orgCalls).toBe(1);
  });

  it('also caches an indeterminate (missing plan field) result, not just a supported one', async () => {
    let orgCalls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme', () => {
        orgCalls += 1;
        return HttpResponse.json({});
      }),
    );
    mockRest('get', '/orgs/acme/organization-roles/42/teams', [{ slug: 'security', name: 'Security' }]);
    mockRest('get', '/orgs/acme/organization-roles/42/users', [{ login: 'octocat', assignment: 'direct' }]);
    await listRoleTeams({ org: 'acme', roleId: 42 });
    await listRoleUsers({ org: 'acme', roleId: 42 });
    expect(orgCalls).toBe(1);
  });

  it('does not cache a rejection, so a free-plan org is re-checked on the next call', async () => {
    let orgCalls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme', () => {
        orgCalls += 1;
        return HttpResponse.json({ plan: { name: 'free' } });
      }),
    );
    await expect(listRoleTeams({ org: 'acme', roleId: 42 })).rejects.toMatchObject({ code: 'feature_unavailable' });
    await expect(listRoleUsers({ org: 'acme', roleId: 42 })).rejects.toMatchObject({ code: 'feature_unavailable' });
    expect(orgCalls).toBe(2);
  });
});

describe('listRoleUsers', () => {
  it('maps users, defaulting a missing assignment to null', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
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

  it('throws feature_unavailable for a free-plan org without calling the users endpoint', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(listRoleUsers({ org: 'acme', roleId: 42 })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });
});

describe('assignTeamRole', () => {
  it('assigns the role when roleId and confirmRoleId match', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
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

  it('throws feature_unavailable for a free-plan org without calling the API', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(assignTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'security' })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('URL-encodes a teamSlug containing reserved characters instead of corrupting the request path', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('put', '/orgs/acme/organization-roles/teams/eng%2Fsecurity/42', {}, 204);
    const result = await assignTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'eng/security' });
    expect(result).toEqual({ org: 'acme', roleId: 42, teamSlug: 'eng/security' });
  });
});

describe('removeTeamRole', () => {
  it('removes the role when roleId and confirmRoleId match', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('delete', '/orgs/acme/organization-roles/teams/security/42', {}, 204);
    const result = await removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'security' });
    expect(result).toEqual({ org: 'acme', roleId: 42, teamSlug: 'security' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 7, teamSlug: 'security' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
  });

  it('throws feature_unavailable for a free-plan org without calling the API', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'security' })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('URL-encodes a teamSlug containing reserved characters instead of corrupting the request path', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('delete', '/orgs/acme/organization-roles/teams/eng%2Fsecurity/42', {}, 204);
    const result = await removeTeamRole({ org: 'acme', roleId: 42, confirmRoleId: 42, teamSlug: 'eng/security' });
    expect(result).toEqual({ org: 'acme', roleId: 42, teamSlug: 'eng/security' });
  });
});

describe('assignUserRole', () => {
  it('assigns the role when roleId and confirmRoleId match', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
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

  it('throws feature_unavailable for a free-plan org without calling the API', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(assignUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'octocat' })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('URL-encodes a username containing reserved characters instead of corrupting the request path', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('put', '/orgs/acme/organization-roles/users/oct%2Focat/42', {}, 204);
    const result = await assignUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'oct/ocat' });
    expect(result).toEqual({ org: 'acme', roleId: 42, username: 'oct/ocat' });
  });
});

describe('removeUserRole', () => {
  it('removes the role when roleId and confirmRoleId match', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('delete', '/orgs/acme/organization-roles/users/octocat/42', {}, 204);
    const result = await removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'octocat' });
    expect(result).toEqual({ org: 'acme', roleId: 42, username: 'octocat' });
  });

  it('throws confirmation_mismatch before calling the API when roleId and confirmRoleId differ', async () => {
    await expect(removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 7, username: 'octocat' })).rejects.toMatchObject({
      code: 'confirmation_mismatch',
    });
  });

  it('throws feature_unavailable for a free-plan org without calling the API', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'free' } });
    await expect(removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'octocat' })).rejects.toMatchObject({
      code: 'feature_unavailable',
      details: { org: 'acme', plan: 'free' },
    });
  });

  it('URL-encodes a username containing reserved characters instead of corrupting the request path', async () => {
    mockRest('get', '/orgs/acme', { plan: { name: 'enterprise' } });
    mockRest('delete', '/orgs/acme/organization-roles/users/oct%2Focat/42', {}, 204);
    const result = await removeUserRole({ org: 'acme', roleId: 42, confirmRoleId: 42, username: 'oct/ocat' });
    expect(result).toEqual({ org: 'acme', roleId: 42, username: 'oct/ocat' });
  });
});
