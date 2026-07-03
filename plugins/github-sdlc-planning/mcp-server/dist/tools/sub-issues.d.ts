import { type GithubClientDeps } from '../github-client.js';
export declare const MAX_SUB_ISSUES_PER_PARENT = 100;
export declare const MAX_NESTING_LEVELS = 8;
export interface AddSubIssueInput {
    owner: string;
    repo: string;
    parentNumber: number;
    childNumber: number;
    /** Defaults to owner/repo — sub-issues can cross repos within the same org. */
    childOwner?: string;
    childRepo?: string;
    /** GitHub's addSubIssue replaceParent option — used on a concurrent
     * re-parent so the second call succeeds cleanly instead of erroring. */
    replaceParent?: boolean;
}
export interface AddSubIssueResult {
    parentNodeId: string;
    childNodeId: string;
    replacedParent: boolean;
}
/** AC-2: reject with `limit_exceeded` before forwarding to GitHub if the
 * parent already has 100 sub-issues or the resulting hierarchy would exceed
 * 8 nesting levels. Edge Case: concurrent re-parenting uses replaceParent. */
export declare function addSubIssue(input: AddSubIssueInput, deps?: GithubClientDeps): Promise<AddSubIssueResult>;
export interface ListSubIssuesInput {
    owner: string;
    repo: string;
    parentNumber: number;
}
export interface SubIssueSummaryItem {
    number: number;
    nodeId: string;
    title: string;
    state: string;
}
export interface ListSubIssuesResult {
    total: number;
    completed: number;
    percentCompleted: number;
    items: SubIssueSummaryItem[];
}
export declare function listSubIssues(input: ListSubIssuesInput, deps?: GithubClientDeps): Promise<ListSubIssuesResult>;
