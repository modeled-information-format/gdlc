import { githubGraphQL, githubRest, type GithubClientDeps } from '../github-client.js';
import { resolveRepositoryId, resolveIssueTypeId } from '../resolvers.js';
import { formatMifIssueBody, type MifIssueMeta } from '../mif.js';

export interface CreateIssueInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  milestoneNumber?: number;
  issueType?: string;
  mif: MifIssueMeta;
}

export interface CreateIssueResult {
  number: number;
  nodeId: string;
  url: string;
  body: string;
}

const CREATE_ISSUE_MUTATION = `
  mutation($repositoryId: ID!, $title: String!, $body: String!, $labelIds: [ID!], $assigneeIds: [ID!], $milestoneId: ID, $issueTypeId: ID) {
    createIssue(input: {
      repositoryId: $repositoryId, title: $title, body: $body,
      labelIds: $labelIds, assigneeIds: $assigneeIds, milestoneId: $milestoneId, issueTypeId: $issueTypeId
    }) {
      issue { number id url body }
    }
  }
`;

interface CreateIssueResponse {
  createIssue: { issue: { number: number; id: string; url: string; body: string } };
}

interface NodeIdLookup {
  node_id: string;
}

async function resolveLabelIds(owner: string, repo: string, labels: string[], deps: GithubClientDeps): Promise<string[]> {
  return Promise.all(
    labels.map(async (name) => {
      const data = (await githubRest(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {}, deps)) as NodeIdLookup;
      return data.node_id;
    }),
  );
}

async function resolveAssigneeIds(logins: string[], deps: GithubClientDeps): Promise<string[]> {
  return Promise.all(
    logins.map(async (login) => {
      const data = (await githubRest(`/users/${encodeURIComponent(login)}`, {}, deps)) as NodeIdLookup;
      return data.node_id;
    }),
  );
}

async function resolveMilestoneId(owner: string, repo: string, number: number, deps: GithubClientDeps): Promise<string> {
  const data = (await githubRest(`/repos/${owner}/${repo}/milestones/${number}`, {}, deps)) as NodeIdLookup;
  return data.node_id;
}

/** AC-1: create the issue via the GraphQL createIssue mutation and prepend
 * the MIF comment block to the body before returning. */
export async function createIssue(input: CreateIssueInput, deps: GithubClientDeps = {}): Promise<CreateIssueResult> {
  const repositoryId = await resolveRepositoryId(input.owner, input.repo, deps);
  const [labelIds, assigneeIds, milestoneId, issueTypeId] = await Promise.all([
    input.labels?.length ? resolveLabelIds(input.owner, input.repo, input.labels, deps) : Promise.resolve(undefined),
    input.assignees?.length ? resolveAssigneeIds(input.assignees, deps) : Promise.resolve(undefined),
    input.milestoneNumber !== undefined
      ? resolveMilestoneId(input.owner, input.repo, input.milestoneNumber, deps)
      : Promise.resolve(undefined),
    // Issue types are org-level; `owner` is treated as the org login.
    input.issueType ? resolveIssueTypeId(input.owner, input.issueType, deps) : Promise.resolve(undefined),
  ]);

  const bodyWithMif = formatMifIssueBody(input.mif, input.body);

  const data = await githubGraphQL<CreateIssueResponse>(
    CREATE_ISSUE_MUTATION,
    { repositoryId, title: input.title, body: bodyWithMif, labelIds, assigneeIds, milestoneId, issueTypeId },
    {},
    deps,
  );

  return {
    number: data.createIssue.issue.number,
    nodeId: data.createIssue.issue.id,
    url: data.createIssue.issue.url,
    body: data.createIssue.issue.body,
  };
}

export interface UpdateIssueInput {
  owner: string;
  repo: string;
  number: number;
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  issueType?: string;
}

export interface UpdateIssueResult {
  number: number;
  url: string;
}

interface RestIssueResponse {
  number: number;
  html_url: string;
}

/** AC-7: reject an issueType assignment absent from organization.issueTypes
 * before calling the update endpoint. */
export async function updateIssue(input: UpdateIssueInput, deps: GithubClientDeps = {}): Promise<UpdateIssueResult> {
  if (input.issueType !== undefined) {
    // Org-level lookup; throws PlanningError('unknown_issue_type', ...) if absent.
    await resolveIssueTypeId(input.owner, input.issueType, deps);
  }

  const patchBody: Record<string, unknown> = {};
  if (input.title !== undefined) patchBody.title = input.title;
  if (input.body !== undefined) patchBody.body = input.body;
  if (input.state !== undefined) patchBody.state = input.state;
  if (input.issueType !== undefined) patchBody.type = { name: input.issueType };

  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.number}`,
    { method: 'PATCH', body: patchBody },
    deps,
  )) as RestIssueResponse;

  return { number: data.number, url: data.html_url };
}
