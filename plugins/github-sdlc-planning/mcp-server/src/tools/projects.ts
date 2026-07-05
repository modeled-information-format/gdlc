import { githubGraphQL, assertProjectScope, type GithubClientDeps } from '../github-client.js';
import { resolveIssueNodeId, resolveProjectNodeId, type ProjectOwnerType } from '../resolvers.js';

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

const ADD_ITEM_MUTATION = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

interface AddItemResponse {
  addProjectV2ItemById: { item: { id: string } };
}

const ISSUE_PROJECT_ITEMS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        projectItems(first: 100) {
          nodes { id project { id } }
        }
      }
    }
  }
`;

interface IssueProjectItemsResponse {
  repository?: {
    issue?: { projectItems: { nodes: Array<{ id: string; project: { id: string } }> } } | null;
  } | null;
}

/** AC-3: resolve node IDs (issue, project) before mutating, never a numeric
 * issue/project number. AC-4: fail with a named `project`-scope error, not
 * GitHub's raw GraphQL permission error. ADR-0003: query whether the issue
 * already has an item on the target project before mutating, and return
 * that item instead of creating a duplicate. */
export async function addItemToProject(input: AddItemToProjectInput, deps: GithubClientDeps = {}): Promise<AddItemToProjectResult> {
  await assertProjectScope(deps.fetchImpl);
  const [contentId, projectId] = await Promise.all([
    resolveIssueNodeId(input.owner, input.repo, input.issueNumber, deps),
    resolveProjectNodeId(input.projectOwnerLogin, input.projectNumber, input.projectOwnerType ?? 'organization', deps),
  ]);

  const itemsData = await githubGraphQL<IssueProjectItemsResponse>(
    ISSUE_PROJECT_ITEMS_QUERY,
    { owner: input.owner, repo: input.repo, number: input.issueNumber },
    {},
    deps,
  );
  const existingItem = (itemsData.repository?.issue?.projectItems?.nodes ?? []).find((n) => n.project.id === projectId);
  if (existingItem) {
    return { itemId: existingItem.id, existed: true };
  }

  const data = await githubGraphQL<AddItemResponse>(ADD_ITEM_MUTATION, { projectId, contentId }, {}, deps);
  return { itemId: data.addProjectV2ItemById.item.id, existed: false };
}

export type FieldValueInput =
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'date'; date: string }
  | { kind: 'singleSelect'; optionId: string }
  | { kind: 'iteration'; iterationId: string };

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

const UPDATE_FIELD_VALUE_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
    updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value }) {
      projectV2Item { id }
    }
  }
`;

function toGraphQLFieldValue(value: FieldValueInput): Record<string, unknown> {
  switch (value.kind) {
    case 'text':
      return { text: value.text };
    case 'number':
      return { number: value.number };
    case 'date':
      return { date: value.date };
    case 'singleSelect':
      return { singleSelectOptionId: value.optionId };
    case 'iteration':
      return { iterationId: value.iterationId };
  }
}

export async function setFieldValue(input: SetFieldValueInput, deps: GithubClientDeps = {}): Promise<SetFieldValueResult> {
  await assertProjectScope(deps.fetchImpl);
  const projectId = await resolveProjectNodeId(
    input.projectOwnerLogin,
    input.projectNumber,
    input.projectOwnerType ?? 'organization',
    deps,
  );
  await githubGraphQL(
    UPDATE_FIELD_VALUE_MUTATION,
    { projectId, itemId: input.itemId, fieldId: input.fieldId, value: toGraphQLFieldValue(input.value) },
    {},
    deps,
  );
  return { itemId: input.itemId };
}

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

const GET_PROJECT_ITEMS_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100) {
          nodes {
            id
            content {
              ... on Issue { title number repository { nameWithOwner } }
              ... on PullRequest { title number repository { nameWithOwner } }
              ... on DraftIssue { title }
            }
            fieldValues(first: 20) {
              nodes {
                ... on ProjectV2ItemFieldTextValue { text field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldNumberValue { number field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldDateValue { date field { ... on ProjectV2FieldCommon { name } } }
                ... on ProjectV2ItemFieldSingleSelectValue { name field { ... on ProjectV2FieldCommon { name } } }
              }
            }
          }
        }
      }
    }
  }
`;

interface RawFieldValueNode {
  text?: string;
  number?: number;
  date?: string;
  name?: string;
  field?: { name?: string };
}

interface GetProjectItemsResponse {
  node: {
    items?: {
      nodes: Array<{
        id: string;
        content: { title?: string; number?: number; repository?: { nameWithOwner?: string } } | null;
        fieldValues: { nodes: RawFieldValueNode[] };
      }>;
    };
  } | null;
}

export async function getProjectItems(input: GetProjectItemsInput, deps: GithubClientDeps = {}): Promise<GetProjectItemsResult> {
  const projectId = await resolveProjectNodeId(
    input.projectOwnerLogin,
    input.projectNumber,
    input.projectOwnerType ?? 'organization',
    deps,
  );
  const data = await githubGraphQL<GetProjectItemsResponse>(GET_PROJECT_ITEMS_QUERY, { projectId }, {}, deps);
  const nodes = data.node?.items?.nodes ?? [];
  return {
    items: nodes.map((n) => ({
      id: n.id,
      title: n.content?.title ?? null,
      number: n.content?.number ?? null,
      repo: n.content?.repository?.nameWithOwner ?? null,
      fieldValues: n.fieldValues.nodes
        .filter((fv) => fv.field?.name !== undefined)
        .map((fv) => ({
          fieldName: fv.field?.name as string,
          text: fv.text,
          number: fv.number,
          date: fv.date,
          optionName: fv.name,
        })),
    })),
  };
}
