import { githubRest, githubGraphQL } from './github-client.js';
import { PlanningError } from './errors.js';
/** AC-3: resolve GitHub node IDs before any Projects v2 mutation, never a
 * numeric issue/project number. Edge Case: name which lookup step failed. */
export async function resolveRepositoryId(owner, repo, deps = {}) {
    try {
        const data = (await githubRest(`/repos/${owner}/${repo}`, {}, deps));
        if (!data.node_id)
            throw new Error('response missing node_id');
        return data.node_id;
    }
    catch (cause) {
        throw new PlanningError('resolve_issue_id', `Failed to resolve repository node ID for ${owner}/${repo}`, {
            lookupStep: 'resolve_repository_id',
            cause: cause instanceof Error ? cause.message : String(cause),
        });
    }
}
export async function resolveIssueNodeId(owner, repo, number, deps = {}) {
    try {
        const data = (await githubRest(`/repos/${owner}/${repo}/issues/${number}`, {}, deps));
        if (!data.node_id)
            throw new Error('response missing node_id');
        return data.node_id;
    }
    catch (cause) {
        throw new PlanningError('resolve_issue_id', `Failed to resolve issue node ID for ${owner}/${repo}#${number}`, {
            lookupStep: 'resolve_issue_id',
            cause: cause instanceof Error ? cause.message : String(cause),
        });
    }
}
const ORG_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    organization(login: $login) { projectV2(number: $number) { id } }
  }
`;
const USER_PROJECT_ID_QUERY = `
  query($login: String!, $number: Int!) {
    user(login: $login) { projectV2(number: $number) { id } }
  }
`;
export async function resolveProjectNodeId(ownerLogin, projectNumber, ownerType = 'organization', deps = {}) {
    try {
        if (ownerType === 'organization') {
            const data = await githubGraphQL(ORG_PROJECT_ID_QUERY, { login: ownerLogin, number: projectNumber }, {}, deps);
            const id = data.organization?.projectV2?.id;
            if (!id)
                throw new Error('organization project not found');
            return id;
        }
        const data = await githubGraphQL(USER_PROJECT_ID_QUERY, { login: ownerLogin, number: projectNumber }, {}, deps);
        const id = data.user?.projectV2?.id;
        if (!id)
            throw new Error('user project not found');
        return id;
    }
    catch (cause) {
        throw new PlanningError('resolve_project_id', `Failed to resolve project node ID for ${ownerLogin} project #${projectNumber}`, { lookupStep: 'resolve_project_id', cause: cause instanceof Error ? cause.message : String(cause) });
    }
}
const ISSUE_TYPES_QUERY = `
  query($login: String!) {
    organization(login: $login) { issueTypes(first: 25) { nodes { id name } } }
  }
`;
/** Copilot review finding on #108: create_issue's auto-derived issueType now
 * calls resolveIssueTypeId on every create, and bulk callers (epic-decomposition)
 * create many issues against the same org in one run -- memoize per org for the
 * life of the process so that only re-fetches on the first call, matching the
 * cachedToken/projectScopeChecked pattern already used in github-client.ts. A
 * failed fetch evicts itself so a transient error doesn't cache forever. */
const issueTypesCache = new Map();
async function fetchIssueTypes(org, deps) {
    let cached = issueTypesCache.get(org);
    if (!cached) {
        cached = githubGraphQL(ISSUE_TYPES_QUERY, { login: org }, {}, deps).then((data) => data.organization?.issueTypes?.nodes ?? []);
        cached.catch(() => issueTypesCache.delete(org));
        issueTypesCache.set(org, cached);
    }
    return cached;
}
/** Test-only: clear the per-org issueTypes memoization between test cases. */
export function resetIssueTypesCacheForTests() {
    issueTypesCache.clear();
}
/** AC-7: reject an issueTypeId assignment absent from the org's
 * organization.issueTypes before calling updateIssue/PATCH. */
export async function resolveIssueTypeId(org, typeName, deps = {}) {
    const nodes = await fetchIssueTypes(org, deps);
    const match = nodes.find((n) => n.name === typeName);
    if (!match) {
        throw new PlanningError('unknown_issue_type', `Issue type "${typeName}" is not defined in organization "${org}"'s issueTypes`, {
            org,
            typeName,
            available: nodes.map((n) => n.name),
        });
    }
    return match.id;
}
//# sourceMappingURL=resolvers.js.map