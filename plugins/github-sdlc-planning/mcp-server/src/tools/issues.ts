import { githubGraphQL, githubRest, type GithubClientDeps } from '../github-client.js';
import { resolveRepositoryId, resolveIssueTypeId } from '../resolvers.js';
import { formatMifIssueBody, type MifIssueMeta, type MifIssueType } from '../mif.js';
import { isPlanningError } from '../errors.js';

/** Issue #108 Bug 2: create_issue previously never set a native issueType
 * unless the caller passed one explicitly, leaving decomposition output
 * (e.g. epic-decomposition's Epic/Story/Task issues) unclassified by
 * default. This org's issue types are Task/Bug/Feature only -- Initiative/
 * Epic/Story have no native equivalent, so they map to the closest fit,
 * Feature. */
const MIF_TYPE_TO_NATIVE_ISSUE_TYPE: Record<MifIssueType, string> = {
  Initiative: 'Feature',
  Epic: 'Feature',
  Story: 'Feature',
  Task: 'Task',
  Bug: 'Bug',
  Feature: 'Feature',
};

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

/** An explicit `issueType` still fails closed on an unknown name (unchanged
 * from before). A type derived from `mif.type` is a best-effort default:
 * if the org hasn't defined that native type, degrade to no type rather
 * than failing the whole create over a classification nicety. */
async function resolveEffectiveIssueTypeId(
  owner: string,
  input: CreateIssueInput,
  deps: GithubClientDeps,
): Promise<string | undefined> {
  // Matches the pre-#108 truthy check that gated the original resolveIssueTypeId
  // call (`input.issueType ? ... : ...`) -- an explicit empty string is treated
  // as "not given" rather than a new hard-fail case this fix would introduce.
  const explicit = Boolean(input.issueType);
  const typeName = input.issueType || MIF_TYPE_TO_NATIVE_ISSUE_TYPE[input.mif.type];
  try {
    return await resolveIssueTypeId(owner, typeName, deps);
  } catch (err) {
    if (explicit || !isPlanningError(err) || err.code !== 'unknown_issue_type') throw err;
    return undefined;
  }
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
    resolveEffectiveIssueTypeId(input.owner, input, deps),
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
  // Issue #108: the REST PATCH endpoint's `type` field is the bare type name
  // string, not an object -- `{ name: input.issueType }` silently no-ops
  // (200 OK, issueType stays null) because it doesn't match the field shape.
  if (input.issueType !== undefined) patchBody.type = input.issueType;

  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.number}`,
    { method: 'PATCH', body: patchBody },
    deps,
  )) as RestIssueResponse;

  return { number: data.number, url: data.html_url };
}
