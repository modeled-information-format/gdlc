import { githubRest, type GithubClientDeps, type RestOptions } from '../github-client.js';
import { OrgIdentityError } from '../errors.js';
import { singleflightCache } from '@github-sdlc-plugins/singleflight-cache';

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

/** Memoizes the plan check per org via the shared singleflightCache helper
 * (gdlc#130 -- extracted from this exact pattern, which used to be
 * hand-rolled here identically to github-sdlc-planning's issueTypesCache):
 * the in-flight promise itself is cached (not just its resolved value), so
 * concurrent calls for the same not-yet-checked org (e.g. a batched
 * listRoleTeams + listRoleUsers) await one request instead of each firing
 * their own. Only a rejection (definite non-enterprise plan) evicts itself
 * on completion, so a transient failure there is always re-checked on the
 * next call -- a resolved entry ('supported' or 'indeterminate') is NOT
 * re-checked; see the no-TTL note below (gdlc#127).
 *
 * Keyed only by org, not by identity (gdlc#126): index.ts's `wrap()` never
 * passes `deps` to any of these tools, so every real call uses the default
 * `deps = {}`, which resolves through github-client.ts's `resolveToken()` --
 * itself a process-lifetime singleton. One stdio server process is one
 * identity for its whole lifetime; there is no code path in this codebase
 * that varies `deps.fetchImpl`/the token per call (`roles.test.ts` only
 * intercepts at the network layer via msw, never passes `deps` either). If
 * that ever changes -- e.g. this module gets embedded somewhere that swaps
 * identity mid-process -- this cache would need to key on identity too.
 *
 * No TTL on a resolved entry (gdlc#127): matches issueTypesCache's own
 * process-lifetime-only design. An org's plan tier changing mid-process is
 * rare enough, and this server's process lifetime short enough (one stdio
 * session), that the complexity of expiring/re-validating a resolved
 * verdict isn't proportionate here -- an accepted trade-off, not an
 * oversight. */
const orgPlanSupportCache = new Map<string, Promise<OrganizationRolesSupport>>();

export function resetOrganizationRolesSupportCacheForTests(): void {
  orgPlanSupportCache.clear();
}

/** Plan tiers GitHub documents as not supporting organization roles (an
 * Enterprise Cloud-only feature). A denylist of known-unsupported values,
 * rather than an allowlist of only `'enterprise'`, so a plan name GitHub
 * renames, adds (an EMU-specific label, say), or that this list simply
 * doesn't know about yet is treated as indeterminate -- falling through to
 * the real endpoint -- instead of being rejected outright. Rejecting only
 * on a value we're confident about, and treating everything else as
 * uncertain, matches this guard's overall philosophy (see
 * checkOrganizationRolesSupport below) and avoids a false rejection from
 * API drift, the same class of bug the missing/null-plan-name fixes above
 * already exist to prevent. */
const DEFINITELY_UNSUPPORTED_PLANS = new Set(['free', 'team', 'business']);

/** `plan` is only visible to an org owner (classic PAT) or an App
 * installation holding the separate "Organization plan" permission --
 * neither of which every authorized caller of these tools necessarily has
 * (e.g. an App installation with only organization_administration, or a
 * non-owner admin:org holder). A missing plan is therefore indeterminate,
 * not evidence the feature is unsupported: reject only on a plan name we
 * know for certain doesn't support organization roles, and report
 * indeterminate otherwise (including an unrecognized plan name) so the
 * caller falls through to the real endpoint, exactly as before this guard
 * existed. */
async function checkOrganizationRolesSupport(org: string, deps: GithubClientDeps): Promise<OrganizationRolesSupport> {
  const data = (await githubRest(`/orgs/${org}`, {}, deps)) as RestOrg;
  const planName = data.plan?.name;
  // A non-string value (missing entirely, or an explicit null) is not a
  // definite plan name -- indeterminate, not a rejection. Checking the
  // runtime type rather than just `=== undefined` guards against a plan
  // object present with a null name, which RestOrg's own type doesn't rule
  // out at runtime even though it's typed as `string | undefined`.
  if (typeof planName !== 'string') return 'indeterminate';
  if (DEFINITELY_UNSUPPORTED_PLANS.has(planName)) {
    throw new OrgIdentityError(
      'feature_unavailable',
      `Organization roles are a GitHub Enterprise Cloud feature; org "${org}" is on the "${planName}" plan, which does not support them.`,
      { org, plan: planName },
    );
  }
  if (planName === 'enterprise') return 'supported';
  return 'indeterminate';
}

/** Organization roles are a GitHub Enterprise Cloud feature; every other
 * plan tier deterministically 404s on the organization-roles endpoints.
 * Checking the org's plan first turns that into a clear, typed error
 * instead of a generic github_api_error the caller has to interpret. */
async function assertOrganizationRolesSupported(org: string, deps: GithubClientDeps): Promise<void> {
  await singleflightCache(orgPlanSupportCache, org, () => checkOrganizationRolesSupport(org, deps));
}

/** Single chokepoint for every organization-roles REST call: `path` is the
 * segment after `/orgs/{org}` (e.g. `/organization-roles`,
 * `/organization-roles/42/teams`). Routing every call through here --
 * instead of each tool calling assertOrganizationRolesSupported itself and
 * then githubRest directly -- makes it structurally impossible to reach one
 * of these endpoints without the guard, rather than relying on every future
 * tool remembering to call it.
 *
 * The plan-check GET and this call are two independent githubRest calls,
 * each with their own rate-limit retry/backoff (github-client.ts); a
 * not-yet-cached org under primary rate-limit exhaustion can retry the
 * plan check for the full backoff window before this call even starts its
 * own. Accepted latency cost of centralizing the guard as a separate
 * request rather than folding it into a single call; revisit if MCP-host
 * tool-call timeouts make this a real problem. */
async function organizationRolesRequest(org: string, path: string, opts: RestOptions, deps: GithubClientDeps): Promise<unknown> {
  await assertOrganizationRolesSupported(org, deps);
  return githubRest(`/orgs/${org}${path}`, opts, deps);
}

export async function listOrganizationRoles(input: ListOrganizationRolesInput, deps: GithubClientDeps = {}): Promise<OrganizationRole[]> {
  const data = (await organizationRolesRequest(input.org, '/organization-roles', {}, deps)) as RestListOrganizationRolesResponse;
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
  return (await organizationRolesRequest(input.org, `/organization-roles/${input.roleId}/teams`, {}, deps)) as RoleTeam[];
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
  const data = (await organizationRolesRequest(input.org, `/organization-roles/${input.roleId}/users`, {}, deps)) as RestRoleUser[];
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
  await organizationRolesRequest(input.org, `/organization-roles/teams/${encodeURIComponent(input.teamSlug)}/${input.roleId}`, { method: 'PUT' }, deps);
  return { org: input.org, roleId: input.roleId, teamSlug: input.teamSlug };
}

export async function removeTeamRole(input: TeamRoleInput, deps: GithubClientDeps = {}): Promise<TeamRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await organizationRolesRequest(input.org, `/organization-roles/teams/${encodeURIComponent(input.teamSlug)}/${input.roleId}`, { method: 'DELETE' }, deps);
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
  await organizationRolesRequest(input.org, `/organization-roles/users/${encodeURIComponent(input.username)}/${input.roleId}`, { method: 'PUT' }, deps);
  return { org: input.org, roleId: input.roleId, username: input.username };
}

export async function removeUserRole(input: UserRoleInput, deps: GithubClientDeps = {}): Promise<UserRoleResult> {
  assertConfirmed(input.roleId, input.confirmRoleId);
  await organizationRolesRequest(input.org, `/organization-roles/users/${encodeURIComponent(input.username)}/${input.roleId}`, { method: 'DELETE' }, deps);
  return { org: input.org, roleId: input.roleId, username: input.username };
}
