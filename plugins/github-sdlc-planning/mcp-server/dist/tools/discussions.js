import { githubGraphQL } from '../github-client.js';
import { resolveRepositoryId } from '../resolvers.js';
import { PlanningError } from '../errors.js';
const DISCUSSION_CATEGORIES_QUERY = `
  query($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      discussionCategories(first: 25) { nodes { id name } }
    }
  }
`;
async function resolveCategoryId(owner, repo, categoryName, deps) {
    const data = await githubGraphQL(DISCUSSION_CATEGORIES_QUERY, { owner, repo }, {}, deps);
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
const CREATE_DISCUSSION_MUTATION = `
  mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion { id number title url }
    }
  }
`;
/** AC-6: maps to the GraphQL createDiscussion mutation with required
 * repositoryId, categoryId, body, title. */
export async function createDiscussion(input, deps = {}) {
    const [repositoryId, categoryId] = await Promise.all([
        resolveRepositoryId(input.owner, input.repo, deps),
        resolveCategoryId(input.owner, input.repo, input.categoryName, deps),
    ]);
    const data = await githubGraphQL(CREATE_DISCUSSION_MUTATION, { repositoryId, categoryId, title: input.title, body: input.body }, {}, deps);
    return data.createDiscussion.discussion;
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
export async function listDiscussions(input, deps = {}) {
    const data = await githubGraphQL(LIST_DISCUSSIONS_QUERY, { owner: input.owner, repo: input.repo }, {}, deps);
    return data.repository.discussions.nodes.map((n) => ({
        id: n.id,
        number: n.number,
        title: n.title,
        url: n.url,
        category: n.category.name,
    }));
}
//# sourceMappingURL=discussions.js.map