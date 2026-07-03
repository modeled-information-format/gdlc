import { type GithubClientDeps } from '../github-client.js';
import { type MifIssueMeta } from '../mif.js';
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
/** AC-1: create the issue via the GraphQL createIssue mutation and prepend
 * the MIF comment block to the body before returning. */
export declare function createIssue(input: CreateIssueInput, deps?: GithubClientDeps): Promise<CreateIssueResult>;
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
/** AC-7: reject an issueType assignment absent from organization.issueTypes
 * before calling the update endpoint. */
export declare function updateIssue(input: UpdateIssueInput, deps?: GithubClientDeps): Promise<UpdateIssueResult>;
