import { assertProjectScope, githubGraphQL, githubRest, type GithubClientDeps } from '../github-client.js';
import { BugCaptureError } from '../errors.js';
import {
  resolveProjectNodeId,
  getFieldByName,
  resolveProjectItem,
  findProjectItemForContent,
  setSingleSelectFieldValue,
  type ProjectCoordinates,
} from './project-board.js';

/** Issue #35: lifecycle state as the composite of native GitHub issue state
 * (open/closed) plus the Projects v2 "Status" single-select value, if the
 * issue is on the triage board. The research blueprint's five states (Open,
 * Triaged, In Progress, Resolved, Closed) are a caller-side mapping onto this
 * composite -- deliberately not hardcoded here, since a board's Status
 * options are configured per-project, not by this plugin. */

export const STATUS_FIELD_NAME = 'Status';

export type NativeIssueState = 'open' | 'closed';

export interface GetLifecycleStateInput extends ProjectCoordinates {
  owner: string;
  repo: string;
  issueNumber: number;
}

export interface GetLifecycleStateResult {
  issueNumber: number;
  nativeState: NativeIssueState;
  onBoard: boolean;
  /** The Status field's current option name, or null when the issue is not
   * on the board or the field has no value set. Not an error either way --
   * a caller who needs "no Status field at all" to be a hard failure should
   * use set_lifecycle_state, which mutates and so must resolve it. */
  status: string | null;
}

const ISSUE_STATE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { state }
    }
  }
`;

interface IssueStateResponse {
  repository?: { issue?: { state: 'OPEN' | 'CLOSED' } | null } | null;
}

/** Issue #273: previously queried the issue's own `projectItems` connection
 * for board membership + Status in the same round trip as native state --
 * that connection was confirmed to silently omit items on a project owned by
 * a different entity than the issue's repo (see `findProjectItemForContent`'s
 * doc in project-board.ts). Native state (open/closed) still comes from the
 * issue directly; board membership/status now comes from the same
 * project-side scan `set_severity`/`set_lifecycle_state` use. */
export async function getLifecycleState(input: GetLifecycleStateInput, deps: GithubClientDeps = {}): Promise<GetLifecycleStateResult> {
  const projectId = await resolveProjectNodeId(input, deps);
  const stateData = await githubGraphQL<IssueStateResponse>(
    ISSUE_STATE_QUERY,
    { owner: input.owner, repo: input.repo, number: input.issueNumber },
    deps,
  );
  const issue = stateData.repository?.issue;
  if (!issue) {
    throw new BugCaptureError('resolve_issue_id', `Issue ${input.owner}/${input.repo}#${input.issueNumber} not found`, {
      lookupStep: 'resolve_issue_id',
    });
  }
  const found = await findProjectItemForContent(projectId, input.owner, input.repo, input.issueNumber, deps);
  return {
    issueNumber: input.issueNumber,
    nativeState: issue.state === 'CLOSED' ? 'closed' : 'open',
    onBoard: found !== null,
    status: found?.statusName ?? null,
  };
}

export interface SetLifecycleStateInput extends ProjectCoordinates {
  owner: string;
  repo: string;
  issueNumber: number;
  status: string;
  /** Closes the underlying issue after the Status value is set. The caller
   * decides which Status values are terminal for its board -- this tool does
   * not infer terminality from the option name. */
  closeIfDone?: boolean;
}

export interface SetLifecycleStateResult {
  itemId: string;
  fieldId: string;
  optionId: string;
  status: string;
  closed: boolean;
}

/** Set an issue's Status on the triage board via the project's existing
 * Status field (looked up by name, never created). Fails with a typed error
 * when the issue is not on the board, or the Status field/option is
 * missing. */
export async function setLifecycleState(input: SetLifecycleStateInput, deps: GithubClientDeps = {}): Promise<SetLifecycleStateResult> {
  await assertProjectScope(deps.fetchImpl);
  const projectId = await resolveProjectNodeId(input, deps);
  const { itemId } = await resolveProjectItem(input, projectId, input.owner, input.repo, input.issueNumber, deps);

  const field = await getFieldByName(projectId, STATUS_FIELD_NAME, deps);
  if (!field || field.__typename !== 'ProjectV2SingleSelectField' || !field.id) {
    throw new BugCaptureError(
      'missing_field',
      `Project ${input.projectOwnerLogin}#${input.projectNumber} has no "${STATUS_FIELD_NAME}" single-select field`,
      { fieldName: STATUS_FIELD_NAME },
    );
  }
  const option = (field.options ?? []).find((o) => o.name === input.status);
  if (!option) {
    throw new BugCaptureError(
      'missing_option',
      `"${STATUS_FIELD_NAME}" field has no "${input.status}" option`,
      { fieldName: STATUS_FIELD_NAME, status: input.status, available: (field.options ?? []).map((o) => o.name) },
    );
  }

  await setSingleSelectFieldValue(projectId, itemId, field.id, option.id, deps);

  let closed = false;
  if (input.closeIfDone) {
    await githubRest(
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
      { method: 'PATCH', body: { state: 'closed' } },
      deps,
    );
    closed = true;
  }

  return { itemId, fieldId: field.id, optionId: option.id, status: input.status, closed };
}

/** Issue #36: deduplication. A plain keyword search (REST search/issues) --
 * not embedding/AI similarity, which the research report flags as a
 * separate, out-of-scope concern. */

export interface SearchSimilarIssuesInput {
  owner: string;
  repo: string;
  query: string;
}

export interface SimilarIssueCandidate {
  number: number;
  title: string;
  state: 'open' | 'closed';
  htmlUrl: string;
}

export interface SearchSimilarIssuesResult {
  candidates: SimilarIssueCandidate[];
  totalCount: number;
}

interface RestSearchIssuesResponse {
  total_count: number;
  items: Array<{ number: number; title: string; state: string; html_url: string }>;
}

export async function searchSimilarIssues(input: SearchSimilarIssuesInput, deps: GithubClientDeps = {}): Promise<SearchSimilarIssuesResult> {
  const q = `repo:${input.owner}/${input.repo} is:issue ${input.query}`;
  const data = (await githubRest(`/search/issues?q=${encodeURIComponent(q)}`, {}, deps)) as RestSearchIssuesResponse;
  return {
    candidates: data.items.map((item) => ({
      number: item.number,
      title: item.title,
      state: item.state === 'closed' ? 'closed' : 'open',
      htmlUrl: item.html_url,
    })),
    totalCount: data.total_count,
  };
}

export interface CloseAsDuplicateInput {
  owner: string;
  repo: string;
  issueNumber: number;
  duplicateOfNumber: number;
}

export interface CloseAsDuplicateResult {
  issueNumber: number;
  duplicateOfNumber: number;
  state: 'closed';
  stateReason: 'duplicate';
  commentUrl: string;
}

interface RestCommentResponse {
  html_url: string;
}

/** Closes an issue as a duplicate via the REST PATCH endpoint's
 * state_reason (GraphQL's closeIssue lacks a duplicate reason as of this
 * writing), then posts a comment linking to the canonical issue. */
export async function closeAsDuplicate(input: CloseAsDuplicateInput, deps: GithubClientDeps = {}): Promise<CloseAsDuplicateResult> {
  await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
    { method: 'PATCH', body: { state: 'closed', state_reason: 'duplicate' } },
    deps,
  );
  const comment = (await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
    { method: 'POST', body: { body: `Closing as a duplicate of #${input.duplicateOfNumber}.` } },
    deps,
  )) as RestCommentResponse;

  return {
    issueNumber: input.issueNumber,
    duplicateOfNumber: input.duplicateOfNumber,
    state: 'closed',
    stateReason: 'duplicate',
    commentUrl: comment.html_url,
  };
}
