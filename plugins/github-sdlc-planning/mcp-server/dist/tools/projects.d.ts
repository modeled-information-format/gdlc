import { type GithubClientDeps } from '../github-client.js';
import { type ProjectProfile } from '../project-profile.js';
import { type ProjectOwnerType } from '../resolvers.js';
export interface AddItemToProjectInput {
    owner: string;
    repo: string;
    issueNumber: number;
    projectOwnerLogin: string;
    projectNumber: number;
    projectOwnerType?: ProjectOwnerType;
}
export interface AddItemToProjectResult {
    itemId: string;
    /** True when the issue already had an item on the target project and no
     * mutation was issued (ADR-0003: native auto-add workflows can add an
     * issue to the board before this tool ever runs; addProjectV2ItemById has
     * no idempotency key and would otherwise create a duplicate item). */
    existed: boolean;
}
/** AC-3: resolve node IDs (issue, project) before mutating, never a numeric
 * issue/project number. AC-4: fail with a named `project`-scope error, not
 * GitHub's raw GraphQL permission error. ADR-0003: query whether the issue
 * already has an item on the target project before mutating, and return
 * that item instead of creating a duplicate. */
export declare function addItemToProject(input: AddItemToProjectInput, deps?: GithubClientDeps): Promise<AddItemToProjectResult>;
export type FieldValueInput = {
    kind: 'text';
    text: string;
} | {
    kind: 'number';
    number: number;
} | {
    kind: 'date';
    date: string;
} | {
    kind: 'singleSelect';
    optionId: string;
} | {
    kind: 'iteration';
    iterationId: string;
};
export interface SetFieldValueInput {
    projectOwnerLogin: string;
    projectNumber: number;
    projectOwnerType?: ProjectOwnerType;
    /** Project item node ID — from add_item_to_project's result or get_project_items. */
    itemId: string;
    /** Project field node ID (from addProjectV2Field or a field-listing query). */
    fieldId: string;
    value: FieldValueInput;
}
export interface SetFieldValueResult {
    itemId: string;
}
export declare function setFieldValue(input: SetFieldValueInput, deps?: GithubClientDeps): Promise<SetFieldValueResult>;
export interface GetProjectItemsInput {
    projectOwnerLogin: string;
    projectNumber: number;
    projectOwnerType?: ProjectOwnerType;
}
export interface ProjectItemFieldValue {
    fieldName: string;
    text?: string;
    number?: number;
    date?: string;
    optionName?: string;
}
export interface ProjectItemSummary {
    id: string;
    title: string | null;
    /** Issue/PR number of the item's content — null for a DraftIssue, which
     * has no number. Lets a caller map a project item back to the
     * issue/PR it was created from without a fragile title-string match. */
    number: number | null;
    /** "owner/repo" (GraphQL nameWithOwner) of the item's content — null for a
     * DraftIssue, which has no repository. A Projects v2 board can hold items
     * from multiple repos, so `number` alone is not a safe join key: a caller
     * matching board items by number must also compare `repo`, or two repos'
     * issues sharing the same number can resolve to the wrong item. */
    repo: string | null;
    fieldValues: ProjectItemFieldValue[];
}
export interface GetProjectItemsResult {
    items: ProjectItemSummary[];
}
export declare function getProjectItems(input: GetProjectItemsInput, deps?: GithubClientDeps): Promise<GetProjectItemsResult>;
export interface GetProjectStatusProfileInput {
    projectOwnerLogin: string;
    projectNumber: number;
    projectOwnerType?: ProjectOwnerType;
}
/** gdlc#199/#206: read the durable, XDG-cached Status-field profile for a
 * project (see `project-profile.ts`), refreshing it via a live GraphQL
 * query only when the cache is missing or past its TTL -- callers that
 * need to know a board's REAL Status options (and which documented
 * CLAUDE.md lifecycle stages have no matching option) should call this
 * instead of re-querying the field schema themselves or assuming a
 * uniform 5-stage lifecycle exists on every board. */
export declare function getProjectStatusProfile(input: GetProjectStatusProfileInput, deps?: GithubClientDeps): Promise<ProjectProfile>;
