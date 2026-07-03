import { type GithubClientDeps } from './github-client.js';
/** AC-3: resolve GitHub node IDs before any Projects v2 mutation, never a
 * numeric issue/project number. Edge Case: name which lookup step failed. */
export declare function resolveRepositoryId(owner: string, repo: string, deps?: GithubClientDeps): Promise<string>;
export declare function resolveIssueNodeId(owner: string, repo: string, number: number, deps?: GithubClientDeps): Promise<string>;
export type ProjectOwnerType = 'organization' | 'user';
export declare function resolveProjectNodeId(ownerLogin: string, projectNumber: number, ownerType?: ProjectOwnerType, deps?: GithubClientDeps): Promise<string>;
/** AC-7: reject an issueTypeId assignment absent from the org's
 * organization.issueTypes before calling updateIssue/PATCH. */
export declare function resolveIssueTypeId(org: string, typeName: string, deps?: GithubClientDeps): Promise<string>;
