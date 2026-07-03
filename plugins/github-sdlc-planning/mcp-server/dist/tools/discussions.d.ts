import { type GithubClientDeps } from '../github-client.js';
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
/** AC-6: maps to the GraphQL createDiscussion mutation with required
 * repositoryId, categoryId, body, title. */
export declare function createDiscussion(input: CreateDiscussionInput, deps?: GithubClientDeps): Promise<DiscussionResult>;
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
export declare function listDiscussions(input: ListDiscussionsInput, deps?: GithubClientDeps): Promise<DiscussionSummary[]>;
