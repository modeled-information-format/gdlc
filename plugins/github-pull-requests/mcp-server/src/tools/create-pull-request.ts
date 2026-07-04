import { githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { resolveRepositoryId } from '../resolvers.js';

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  baseRefName: string;
  headRefName: string;
  draft?: boolean;
}

export interface CreatePullRequestResult {
  number: number;
  url: string;
  nodeId: string;
}

const CREATE_PULL_REQUEST_MUTATION = `
  mutation($repositoryId: ID!, $baseRefName: String!, $headRefName: String!, $title: String!, $body: String, $draft: Boolean) {
    createPullRequest(input: {
      repositoryId: $repositoryId, baseRefName: $baseRefName, headRefName: $headRefName,
      title: $title, body: $body, draft: $draft
    }) {
      pullRequest { number url id }
    }
  }
`;

interface CreatePullRequestResponse {
  createPullRequest: { pullRequest: { number: number; url: string; id: string } };
}

/** No MIF frontmatter is attached here: MIF's mif-type enum
 * (Initiative|Epic|Story|Task|Bug|Feature) taxonomizes work items, and a PR
 * is an implementation artifact for one, not a work item itself.
 * Traceability into a tracked issue already exists via get_linked_issues'
 * alreadyTracked field, which reads the *issue's* body. A caller wanting a
 * closing reference writes "Fixes #N" into `body` as plain text.
 *
 * GraphQL-level rejections (an open PR already exists for this head ref, a
 * nonexistent branch) are left to surface as github_api_error verbatim, no
 * pre-validation — matching how request_review already lets team-access
 * rejections pass through untouched. */
export async function createPullRequest(input: CreatePullRequestInput, deps: GithubClientDeps = {}): Promise<CreatePullRequestResult> {
  const repositoryId = await resolveRepositoryId(input.owner, input.repo, deps);
  const data = await githubGraphQL<CreatePullRequestResponse>(
    CREATE_PULL_REQUEST_MUTATION,
    {
      repositoryId,
      baseRefName: input.baseRefName,
      headRefName: input.headRefName,
      title: input.title,
      body: input.body,
      draft: input.draft,
    },
    deps,
  );
  return {
    number: data.createPullRequest.pullRequest.number,
    url: data.createPullRequest.pullRequest.url,
    nodeId: data.createPullRequest.pullRequest.id,
  };
}
