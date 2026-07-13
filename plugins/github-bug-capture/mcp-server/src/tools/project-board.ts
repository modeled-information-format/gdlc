import { githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { BugCaptureError } from '../errors.js';

/** Shared Projects v2 resolution helpers: project node ID, field lookup by
 * name, an issue's board item (and the underlying content-matching scan
 * findProjectItemForContent), and the single-select field write. Both
 * triage-board.ts (Severity) and lifecycle.ts (Status) resolve the same
 * board shape through these, so the resolution/error semantics stay single-
 * sourced instead of drifting per bug-domain field. */

export type ProjectOwnerType = 'organization' | 'user';

export interface ProjectCoordinates {
  projectOwnerLogin: string;
  projectNumber: number;
  projectOwnerType?: ProjectOwnerType;
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

interface OrgProjectV2IdResponse {
  organization?: { projectV2?: { id: string } | null } | null;
}

interface UserProjectV2IdResponse {
  user?: { projectV2?: { id: string } | null } | null;
}

/** Resolve GitHub node IDs before any Projects v2 mutation, never a numeric
 * project number. */
export async function resolveProjectNodeId(coords: ProjectCoordinates, deps: GithubClientDeps = {}): Promise<string> {
  const ownerType = coords.projectOwnerType ?? 'organization';
  try {
    if (ownerType === 'organization') {
      const data = await githubGraphQL<OrgProjectV2IdResponse>(
        ORG_PROJECT_ID_QUERY,
        { login: coords.projectOwnerLogin, number: coords.projectNumber },
        deps,
      );
      const id = data.organization?.projectV2?.id;
      if (!id) throw new Error('organization project not found');
      return id;
    }
    const data = await githubGraphQL<UserProjectV2IdResponse>(
      USER_PROJECT_ID_QUERY,
      { login: coords.projectOwnerLogin, number: coords.projectNumber },
      deps,
    );
    const id = data.user?.projectV2?.id;
    if (!id) throw new Error('user project not found');
    return id;
  } catch (cause) {
    throw new BugCaptureError(
      'resolve_project_id',
      `Failed to resolve project node ID for ${coords.projectOwnerLogin} project #${coords.projectNumber}`,
      { lookupStep: 'resolve_project_id', cause: cause instanceof Error ? cause.message : String(cause) },
    );
  }
}

const PROJECT_FIELDS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2FieldCommon { id name }
            ... on ProjectV2SingleSelectField { id name options { id name } }
          }
        }
      }
    }
  }
`;

export interface ProjectFieldNode {
  __typename: string;
  id?: string;
  name?: string;
  options?: Array<{ id: string; name: string }>;
}

interface ProjectFieldsResponse {
  node: { fields?: { nodes: ProjectFieldNode[] } } | null;
}

export async function getFieldByName(projectId: string, name: string, deps: GithubClientDeps = {}): Promise<ProjectFieldNode | undefined> {
  const data = await githubGraphQL<ProjectFieldsResponse>(PROJECT_FIELDS_QUERY, { projectId }, deps);
  const nodes = data.node?.fields?.nodes ?? [];
  return nodes.find((n) => n.name === name);
}

const PROJECT_ITEMS_BY_CONTENT_QUERY = `
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue { number repository { nameWithOwner } }
              ... on PullRequest { number repository { nameWithOwner } }
            }
            fieldValueByName(name: "Status") {
              ... on ProjectV2ItemFieldSingleSelectValue { name }
            }
          }
        }
      }
    }
  }
`;

interface RawContentItemNode {
  id: string;
  content: { number?: number; repository?: { nameWithOwner?: string } } | null;
  fieldValueByName: { name: string } | null;
}

interface ProjectItemsByContentResponse {
  node: {
    items?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes: RawContentItemNode[] };
  } | null;
}

/** Issue #273: gdlc#200 already proved `ProjectV2.items` (paginated from the
 * PROJECT side) is the reliable way to enumerate a board's items --
 * `Issue.projectItems` (paginated from the ISSUE side, as this function used
 * to query) was confirmed live to silently omit items on a project owned by
 * a different entity than the issue's own repo (e.g. a user-owned project
 * holding an item for an org repo's issue: `totalCount: 1` on the issue side,
 * listing only the org project, while the user project's item demonstrably
 * existed via a direct `ProjectV2.items` query). `set_severity` and
 * `set_lifecycle_state` both failed with a false `issue_not_on_board` for
 * exactly this case. Bounded the same way `fetchAllProjectItemNodes` is in
 * github-sdlc-planning's projects.ts, for the same reason: a malformed or
 * looping GraphQL response must throw loudly, not hang or silently
 * truncate. */
const MAX_PAGES = 1000;

async function findProjectItemForContent(
  projectId: string,
  owner: string,
  repo: string,
  issueNumber: number,
  deps: GithubClientDeps = {},
): Promise<{ itemId: string; statusName: string | null } | null> {
  // Copilot review finding: GraphQL accepts mixed-case owner/repo in queries,
  // but `nameWithOwner` comes back in GitHub's own canonical casing -- a
  // case-sensitive match here would produce the exact false `issue_not_on_board`
  // this function exists to eliminate, just triggered by input casing instead
  // of the original cross-owner-type omission.
  const target = `${owner}/${repo}`.toLowerCase();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: ProjectItemsByContentResponse = await githubGraphQL<ProjectItemsByContentResponse>(
      PROJECT_ITEMS_BY_CONTENT_QUERY,
      { projectId, after },
      deps,
    );
    const items = data.node?.items;
    if (items === undefined) return null; // no `items` at all: project not found / no access
    const match = (items?.nodes ?? []).find(
      (n: RawContentItemNode) => n.content?.number === issueNumber && n.content?.repository?.nameWithOwner?.toLowerCase() === target,
    );
    if (match) return { itemId: match.id, statusName: match.fieldValueByName?.name ?? null };
    if (items.pageInfo === undefined) {
      throw new Error(`findProjectItemForContent: malformed response -- items present but pageInfo missing (projectId=${projectId})`);
    }
    if (!items.pageInfo.hasNextPage) return null;
    after = items.pageInfo.endCursor;
  }
  throw new Error(`findProjectItemForContent: exceeded ${MAX_PAGES} pages without hasNextPage becoming false (projectId=${projectId})`);
}

export interface ResolvedProjectItem {
  itemId: string;
}

const ISSUE_EXISTS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
`;

interface IssueExistsResponse {
  repository?: { issue?: { id: string } | null } | null;
}

/** Confirms the issue itself exists, independent of board membership --
 * kept as its own tiny query (rather than folded into
 * `findProjectItemForContent`'s project-side scan, which has no reason to
 * know about issues that aren't on the board at all) so callers can still
 * distinguish "this issue doesn't exist" (`resolve_issue_id`) from "this
 * issue exists but isn't on this board" (`issue_not_on_board`). */
export async function assertIssueExists(owner: string, repo: string, issueNumber: number, deps: GithubClientDeps = {}): Promise<void> {
  const data = await githubGraphQL<IssueExistsResponse>(ISSUE_EXISTS_QUERY, { owner, repo, number: issueNumber }, deps);
  if (!data.repository?.issue) {
    throw new BugCaptureError('resolve_issue_id', `Issue ${owner}/${repo}#${issueNumber} not found`, {
      lookupStep: 'resolve_issue_id',
    });
  }
}

/** Resolve an issue's board item by scanning the project's own items
 * connection (see `findProjectItemForContent`'s doc for why this replaced an
 * issue-side lookup). Fails with a typed error when the issue does not exist,
 * or exists but is not on this project. */
export async function resolveProjectItem(
  coords: ProjectCoordinates,
  projectId: string,
  owner: string,
  repo: string,
  issueNumber: number,
  deps: GithubClientDeps = {},
): Promise<ResolvedProjectItem> {
  await assertIssueExists(owner, repo, issueNumber, deps);
  const found = await findProjectItemForContent(projectId, owner, repo, issueNumber, deps);
  if (!found) {
    throw new BugCaptureError(
      'issue_not_on_board',
      `Issue ${owner}/${repo}#${issueNumber} is not an item on ${coords.projectOwnerLogin} project #${coords.projectNumber}; add it to the board first (github-sdlc-planning's add_item_to_project)`,
      { issueNumber, projectNumber: coords.projectNumber },
    );
  }
  return { itemId: found.itemId };
}

export { findProjectItemForContent };

const UPDATE_FIELD_VALUE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(
      input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
    ) {
      projectV2Item { id }
    }
  }
`;

export async function setSingleSelectFieldValue(
  projectId: string,
  itemId: string,
  fieldId: string,
  optionId: string,
  deps: GithubClientDeps = {},
): Promise<void> {
  await githubGraphQL(UPDATE_FIELD_VALUE_MUTATION, { projectId, itemId, fieldId, optionId }, deps);
}
