import { githubGraphQL, assertProjectScope, type GithubClientDeps } from '../github-client.js';
import { resolvePullRequestNodeId } from '../resolvers.js';
import { resolveProjectNodeId, type ProjectOwnerType } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/resolvers';
import { PrError } from '../errors.js';

export interface AddPullRequestToProjectInput {
  owner: string;
  repo: string;
  pullNumber: number;
  projectOwnerLogin: string;
  projectNumber: number;
  projectOwnerType?: ProjectOwnerType;
}

export interface AddPullRequestToProjectResult {
  itemId: string;
}

const ADD_ITEM_MUTATION = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

interface AddItemResponse {
  addProjectV2ItemById: { item: { id: string } };
}

/** resolveProjectNodeId is shared from github-sdlc-planning (its org/user
 * projectV2 branching logic is too large to duplicate safely), but it throws
 * PlanningError, not PrError — wrapped here so a real failure never escapes
 * this plugin's error shape and skips isPrError() in index.ts. */
async function resolveProjectId(
  login: string,
  number: number,
  ownerType: ProjectOwnerType,
  deps: GithubClientDeps,
): Promise<string> {
  try {
    return await resolveProjectNodeId(login, number, ownerType, deps);
  } catch (cause) {
    throw new PrError('resolve_id_failed', `Failed to resolve project node ID for ${login} project #${number}`, {
      lookupStep: 'resolve_project_id',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function addPullRequestToProject(
  input: AddPullRequestToProjectInput,
  deps: GithubClientDeps = {},
): Promise<AddPullRequestToProjectResult> {
  await assertProjectScope(deps.fetchImpl);
  const [contentId, projectId] = await Promise.all([
    resolvePullRequestNodeId(input.owner, input.repo, input.pullNumber, deps),
    resolveProjectId(input.projectOwnerLogin, input.projectNumber, input.projectOwnerType ?? 'organization', deps),
  ]);
  const data = await githubGraphQL<AddItemResponse>(ADD_ITEM_MUTATION, { projectId, contentId }, deps);
  return { itemId: data.addProjectV2ItemById.item.id };
}
