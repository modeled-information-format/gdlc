import { githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { BugCaptureError } from '../errors.js';

/** Shared Projects v2 resolution helpers: project node ID, field lookup by
 * name, an issue's board item, and the single-select field write. Both
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

const ISSUE_PROJECT_ITEMS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 100) {
          nodes { id project { id } }
        }
      }
    }
  }
`;

interface IssueProjectItemsResponse {
  repository?: {
    issue?: { projectItems: { nodes: Array<{ id: string; project: { id: string } }> } } | null;
  } | null;
}

export interface ResolvedProjectItem {
  itemId: string;
}

/** Resolve an issue's board item through the issue's own projectItems
 * connection (an issue sits on few boards) rather than paginating the whole
 * board. Fails with a typed error when the issue does not exist or is not on
 * this project. */
export async function resolveProjectItem(
  coords: ProjectCoordinates,
  projectId: string,
  owner: string,
  repo: string,
  issueNumber: number,
  deps: GithubClientDeps = {},
): Promise<ResolvedProjectItem> {
  const itemsData = await githubGraphQL<IssueProjectItemsResponse>(
    ISSUE_PROJECT_ITEMS_QUERY,
    { owner, repo, number: issueNumber },
    deps,
  );
  const issue = itemsData.repository?.issue;
  if (!issue) {
    throw new BugCaptureError('resolve_issue_id', `Issue ${owner}/${repo}#${issueNumber} not found`, {
      lookupStep: 'resolve_issue_id',
    });
  }
  const item = issue.projectItems.nodes.find((n) => n.project.id === projectId);
  if (!item) {
    throw new BugCaptureError(
      'issue_not_on_board',
      `Issue ${owner}/${repo}#${issueNumber} is not an item on ${coords.projectOwnerLogin} project #${coords.projectNumber}; add it to the board first (github-sdlc-planning's add_item_to_project)`,
      { issueNumber, projectNumber: coords.projectNumber },
    );
  }
  return { itemId: item.id };
}

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
