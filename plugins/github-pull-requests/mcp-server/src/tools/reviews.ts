import { githubRest, type GithubClientDeps } from '../github-client.js';
import { PrError } from '../errors.js';

export interface PullRequestRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

interface RestPullState {
  state: 'open' | 'closed';
  merged: boolean;
}

/** Edge Case: a review request targets a PR that closed between listing and
 * the request call. Report `stale_target` rather than a generic API error. */
async function assertPullOpen(ref: PullRequestRef, deps: GithubClientDeps): Promise<void> {
  const pr = (await githubRest(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}`, {}, deps)) as RestPullState;
  if (pr.state !== 'open') {
    throw new PrError('stale_target', `PR #${ref.pullNumber} in ${ref.owner}/${ref.repo} is ${pr.merged ? 'merged' : 'closed'}, not open`, {
      pullNumber: ref.pullNumber,
      state: pr.state,
      merged: pr.merged,
    });
  }
}

export interface RequestReviewInput extends PullRequestRef {
  reviewers?: string[];
  teamReviewers?: string[];
}

export interface RequestedReviewers {
  users: string[];
  teams: string[];
}

interface RestRequestedReviewersResponse {
  users: Array<{ login: string }>;
  requested_teams: Array<{ slug: string }>;
}

/** AC-1: request reviewers via POST .../requested_reviewers. */
export async function requestReview(input: RequestReviewInput, deps: GithubClientDeps = {}): Promise<RequestedReviewers> {
  await assertPullOpen(input, deps);
  // Edge Case: a team lacking repo access is a GitHub-side rejection —
  // surfaced verbatim (via githubRest's github_api_error), never retried.
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/requested_reviewers`,
    { method: 'POST', body: { reviewers: input.reviewers ?? [], team_reviewers: input.teamReviewers ?? [] } },
    deps,
  )) as RestRequestedReviewersResponse;
  return { users: data.users.map((u) => u.login), teams: data.requested_teams.map((t) => t.slug) };
}

/** AC-2: return current requested reviewers without a separate Timeline-API call. */
export async function listReviewRequests(input: PullRequestRef, deps: GithubClientDeps = {}): Promise<RequestedReviewers> {
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/requested_reviewers`,
    {},
    deps,
  )) as RestRequestedReviewersResponse;
  return { users: data.users.map((u) => u.login), teams: data.requested_teams.map((t) => t.slug) };
}

export interface RemoveReviewRequestInput extends PullRequestRef {
  reviewers?: string[];
  teamReviewers?: string[];
}

export async function removeReviewRequest(input: RemoveReviewRequestInput, deps: GithubClientDeps = {}): Promise<RequestedReviewers> {
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}/requested_reviewers`,
    { method: 'DELETE', body: { reviewers: input.reviewers ?? [], team_reviewers: input.teamReviewers ?? [] } },
    deps,
  )) as RestRequestedReviewersResponse;
  return { users: data.users.map((u) => u.login), teams: data.requested_teams.map((t) => t.slug) };
}
