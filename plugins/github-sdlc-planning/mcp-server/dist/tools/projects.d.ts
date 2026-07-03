import { type GithubClientDeps } from '../github-client.js';
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
}
/** AC-3: resolve node IDs (issue, project) before mutating, never a numeric
 * issue/project number. AC-4: fail with a named `project`-scope error, not
 * GitHub's raw GraphQL permission error. */
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
    fieldValues: ProjectItemFieldValue[];
}
export interface GetProjectItemsResult {
    items: ProjectItemSummary[];
}
export declare function getProjectItems(input: GetProjectItemsInput, deps?: GithubClientDeps): Promise<GetProjectItemsResult>;
