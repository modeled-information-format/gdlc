import { githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { resolveRepositoryId } from '../resolvers.js';
import { PlanningError } from '../errors.js';

const DISCUSSION_CATEGORIES_QUERY = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      discussionCategories(first: 25) { nodes { id name } }
    }
  }
`;

interface DiscussionCategoriesResponse {
  repository: { discussionCategories: { nodes: Array<{ id: string; name: string }> } };
}

async function resolveCategoryId(owner: string, repo: string, categoryName: string, deps: GithubClientDeps): Promise<string> {
  const data = await githubGraphQL<DiscussionCategoriesResponse>(DISCUSSION_CATEGORIES_QUERY, { owner, repo }, {}, deps);
  const nodes = data.repository.discussionCategories.nodes;
  const match = nodes.find((n) => n.name === categoryName);
  if (!match) {
    throw new PlanningError('github_api_error', `Discussion category "${categoryName}" not found in ${owner}/${repo}`, {
      owner,
      repo,
      categoryName,
      available: nodes.map((n) => n.name),
    });
  }
  return match.id;
}

export interface CreateDiscussionInput {
  owner: string;
  repo: string;
  categoryName: string;
  title: string;
  body: string;
}

export interface DiscussionResult {
  id: string;
  number: number;
  title: string;
  url: string;
}

const CREATE_DISCUSSION_MUTATION = `
  mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion { id number title url }
    }
  }
`;

interface CreateDiscussionResponse {
  createDiscussion: { discussion: DiscussionResult };
}

/** AC-6: maps to the GraphQL createDiscussion mutation with required
 * repositoryId, categoryId, body, title. */
export async function createDiscussion(input: CreateDiscussionInput, deps: GithubClientDeps = {}): Promise<DiscussionResult> {
  const [repositoryId, categoryId] = await Promise.all([
    resolveRepositoryId(input.owner, input.repo, deps),
    resolveCategoryId(input.owner, input.repo, input.categoryName, deps),
  ]);
  const data = await githubGraphQL<CreateDiscussionResponse>(
    CREATE_DISCUSSION_MUTATION,
    { repositoryId, categoryId, title: input.title, body: input.body },
    {},
    deps,
  );
  return data.createDiscussion.discussion;
}

export interface ListDiscussionsInput {
  owner: string;
  repo: string;
}

export interface DiscussionSummary {
  id: string;
  number: number;
  title: string;
  url: string;
  category: string;
}

const LIST_DISCUSSIONS_QUERY = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      discussions(first: 50) {
        nodes { id number title url category { name } }
      }
    }
  }
`;

interface ListDiscussionsResponse {
  repository: { discussions: { nodes: Array<{ id: string; number: number; title: string; url: string; category: { name: string } }> } };
}

export async function listDiscussions(input: ListDiscussionsInput, deps: GithubClientDeps = {}): Promise<DiscussionSummary[]> {
  const data = await githubGraphQL<ListDiscussionsResponse>(LIST_DISCUSSIONS_QUERY, { owner: input.owner, repo: input.repo }, {}, deps);
  return data.repository.discussions.nodes.map((n) => ({
    id: n.id,
    number: n.number,
    title: n.title,
    url: n.url,
    category: n.category.name,
  }));
}
