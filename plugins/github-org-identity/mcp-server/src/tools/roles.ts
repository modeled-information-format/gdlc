import { githubRest, type GithubClientDeps } from '../github-client.js';
import { OrgIdentityError } from '../errors.js';

export interface ListOrganizationRolesInput {
  org: string;
}

export interface OrganizationRole {
  id: number;
  name: string;
  description: string | null;
  source: string;
  baseRole: string | null;
}

interface RestOrganizationRole {
  id: number;
  name: string;
  description: string | null;
  source: string;
  base_role: string | null;
}

interface RestListOrganizationRolesResponse {
  total_count: number;
  roles: RestOrganizationRole[];
}

interface RestOrg {
  plan?: { name?: string };
}

type OrganizationRolesSupport = 'supported' | 'indeterminate';

/** Memoizes the plan check per org, matching the issueTypesCache pattern in
 * github-sdlc-planning's resolvers.ts: the in-flight promise itself is
 * cached (not just its resolved value), so concurrent calls for the same
 * not-yet-checked org (e.g. a batched listRoleTeams + listRoleUsers) await
 * one request instead of each firing their own. A rejection (definite
 * non-enterprise plan) evicts itself on completion, so it's never cached --
 * a transient failure or a plan change is always re-checked on the next
 * call. */
const orgPlanSupportCache = new Map<string, Promise<OrganizationRolesSupport>>();

export function resetOrganizationRolesSupportCacheForTests(): void {
  orgPlanSupportCache.clear();
}

/** `plan` is only visible to an org owner (classic PAT) or an App
 * installation holding the separate "Organization plan" permission --
 * neither of which every authorized caller of these tools necessarily has
 * (e.g. an App installation with only organization_administration, or a
 * non-owner admin:org holder). A missing plan is therefore indeterminate,
 * not evidence the feature is unsupported: reject only on a definite
 * non-enterprise plan name, and report indeterminate otherwise so the
 * caller falls through to the real endpoint, exactly as before this guard
 * existed. */
async function checkOrganizationRolesSupport(org: string, deps: GithubClientDeps): Promise<OrganizationRolesSupport> {
  const data = (await githubRest(`/orgs/${org}`, {}, deps)) as RestOrg;
  const planName = data.plan?.name;
  if (planName === undefined) return 'indeterminate';
  if (planName !== 'enterprise') {
    throw new OrgIdentityError(
      'feature_unavailable',
      `Organization roles are a GitHub Enterprise Cloud feature; org "${org}" is on the "${planName}" plan, which does not support them.`,
      { org, plan: planName },
    );
  }
  return 'supported';
}

/** Organization roles are a GitHub Enterprise Cloud feature; every other
 * plan tier deterministically 404s on the organization-roles endpoints.
 * Checking the org's plan first turns that into a clear, typed error
 * instead of a generic github_api_error the caller has to interpret. Every
 * tool below that touches an organization-roles endpoint calls this first. */
async function assertOrganizationRolesSupported(org: string, deps: GithubClientDeps): Promise<void> {
  let cached = orgPlanSupportCache.get(org);
  if (!cached) {
    cached = checkOrganizationRolesSupport(org, deps);
    cached.catch(() => orgPlanSupportCache.delete(org));
    orgPlanSupportCache.set(org, cached);
  }
  await cached;
}

export async function listOrganizationRoles(input: ListOrganizationRolesInput, deps: GithubClientDeps = {}): Promise<OrganizationRole[]> {
  await assertOrganizationRolesSupported(input.org, deps);
  const data = (await githubRest(`/orgs/${input.org}/organization-roles`, {}, deps)) as RestListOrganizationRolesResponse;
  return data.roles.map((r) => ({ id: r.id, name: r.name, description: r.description, source: r.source, baseRole: r.base_role }));
}

export interface RoleRef {
  org: string;
  roleId: number;
}

export interface RoleTeam {
  slug: string;
  name: string;
}

export async function listRoleTeams(input: RoleRef, deps: GithubClientDeps = {}): Promise<RoleTeam[]> {
  await assertOrganizationRolesSupported(input.org, deps);
  return (await githubRest(`/orgs/${input.org}/organization-roles/${input.roleId}/teams`, {}, deps)) as RoleTeam[];
}

export interface RoleUser {
  login: string;
  assignment: string | null;
}

interface RestRoleUser {
  login: string;
  assignment?: string;
}

/** AC: distinguish a direct role grant from one inherited via team
 * membership -- assignment is undefined on older API responses, reported
 * as null rather than assumed "direct". */
export async function listRoleUsers(input: RoleRef, deps: GithubClientDeps = {}): Promise<RoleUser[]> {
  await assertOrganizationRolesSupported(input.org, deps);
  const data = (await githubRest(`/orgs/${input.org}/organization-roles/${input.roleId}/users`, {}, deps)) as RestRoleUser[];
  return data.map((u) => ({ login: u.login, assignment: u.assignment ?? null }));
}

/** Every write tool below requires the target roleId twice, under two
 * different field names (roleId/confirmRoleId): org-role assignment
 * mutates org-wide permissions, a different risk class than this
 * marketplace's other tools (create_issue, create_pull_request, ...),
 * which only ever touch a single issue/PR/project item. A mismatch is
 * refused before any API call -- see README's "Confirm-echo contract". */
function assertConfirmed(roleId: number, confirmRoleId: number): void {
  if (roleId !== confirmRoleId) {
    throw new OrgIdentityError(
      'confirmation_mismatch',
      `roleId (${roleId}) and confirmRoleId (${confirmRoleId}) must match to confirm this write.`,
      { roleId, confirmRoleId },
    );
  }
}

export interface TeamRoleInput {
  org: string;
  roleId: number;
  confirmRoleId: number;
  teamSlug: string;
}

export interface TeamRoleResult {
  org: string;
  roleId: number;
  teamSlug: string;
}

export async function assignTeamRole(input: TeamRoleInput, deps: GithubClientDeps = {}): Promise<TeamRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await assertOrganizationRolesSupported(input.org, deps);
  await githubRest(`/orgs/${input.org}/organization-roles/teams/${encodeURIComponent(input.teamSlug)}/${input.roleId}`, { method: 'PUT' }, deps);
  return { org: input.org, roleId: input.roleId, teamSlug: input.teamSlug };
}

export async function removeTeamRole(input: TeamRoleInput, deps: GithubClientDeps = {}): Promise<TeamRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await assertOrganizationRolesSupported(input.org, deps);
  await githubRest(`/orgs/${input.org}/organization-roles/teams/${encodeURIComponent(input.teamSlug)}/${input.roleId}`, { method: 'DELETE' }, deps);
  return { org: input.org, roleId: input.roleId, teamSlug: input.teamSlug };
}

export interface UserRoleInput {
  org: string;
  roleId: number;
  confirmRoleId: number;
  username: string;
}

export interface UserRoleResult {
  org: string;
  roleId: number;
  username: string;
}

export async function assignUserRole(input: UserRoleInput, deps: GithubClientDeps = {}): Promise<UserRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await assertOrganizationRolesSupported(input.org, deps);
  await githubRest(`/orgs/${input.org}/organization-roles/users/${encodeURIComponent(input.username)}/${input.roleId}`, { method: 'PUT' }, deps);
  return { org: input.org, roleId: input.roleId, username: input.username };
}

export async function removeUserRole(input: UserRoleInput, deps: GithubClientDeps = {}): Promise<UserRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await assertOrganizationRolesSupported(input.org, deps);
  await githubRest(`/orgs/${input.org}/organization-roles/users/${encodeURIComponent(input.username)}/${input.roleId}`, { method: 'DELETE' }, deps);
  return { org: input.org, roleId: input.roleId, username: input.username };
}
