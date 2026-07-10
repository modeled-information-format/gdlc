import { githubGraphQL, assertProjectScope, type GithubClientDeps } from '../github-client.js';
import { getOrRefreshProjectProfile, type ProjectProfile } from '../project-profile.js';
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
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
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

interface RawProjectItemNode {
  id: string;
  content: { title?: string; number?: number; repository?: { nameWithOwner?: string } } | null;
  fieldValues: { nodes: RawFieldValueNode[] };
}

interface GetProjectItemsResponse {
  node: {
    items?: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawProjectItemNode[];
    };
  } | null;
}

/** gdlc#200: `items(first: 100)` alone only ever returns the board's first
 * page -- confirmed live against the org's real 235-item project board,
 * where this silently dropped issues #319-323 from every caller's view
 * (root-causing `sync_linked_issues_project_field`'s false-negative
 * `notFoundOnBoard`). Loops on `hasNextPage`/`endCursor` until GitHub
 * reports no further page, aggregating every page's nodes before this
 * function's one caller (`getProjectItems`) maps them -- callers see the
 * same flat node list they always did, just complete.
 *
 * Code-review finding: capped at `MAX_PAGES` (100,000 items at 100/page --
 * far beyond any realistic Projects v2 board) rather than looping
 * unbounded. Without this, a malformed or buggy GraphQL response (a stale
 * or repeating `endCursor` with `hasNextPage` never flipping false) would
 * hang the calling MCP tool and burn API rate limit indefinitely. Throws
 * loudly on the cap rather than silently truncating -- silent truncation
 * would reintroduce exactly the "items silently missing from the caller's
 * view" bug this pagination fix exists to eliminate. */
const MAX_PAGES = 1000;

async function fetchAllProjectItemNodes(projectId: string, deps: GithubClientDeps): Promise<RawProjectItemNode[]> {
  const allNodes: RawProjectItemNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: GetProjectItemsResponse = await githubGraphQL<GetProjectItemsResponse>(
      GET_PROJECT_ITEMS_QUERY,
      { projectId, after },
      {},
      deps,
    );
    const items = data.node?.items;
    allNodes.push(...(items?.nodes ?? []));
    if (!items?.pageInfo.hasNextPage) return allNodes;
    after = items.pageInfo.endCursor;
  }
  throw new Error(`fetchAllProjectItemNodes: exceeded ${MAX_PAGES} pages without hasNextPage becoming false (projectId=${projectId})`);
}

export async function getProjectItems(input: GetProjectItemsInput, deps: GithubClientDeps = {}): Promise<GetProjectItemsResult> {
  const projectId = await resolveProjectNodeId(
    input.projectOwnerLogin,
    input.projectNumber,
    input.projectOwnerType ?? 'organization',
    deps,
  );
  const nodes = await fetchAllProjectItemNodes(projectId, deps);
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

const GET_STATUS_FIELD_SCHEMA_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: "Status") {
          ... on ProjectV2SingleSelectField {
            id
            name
            options { id name }
          }
        }
      }
    }
  }
`;

interface GetStatusFieldSchemaResponse {
  node: {
    field?: { id: string; name: string; options: Array<{ id: string; name: string }> } | null;
  } | null;
}

export interface GetProjectStatusProfileInput {
  projectOwnerLogin: string;
  projectNumber: number;
  projectOwnerType?: ProjectOwnerType;
}

/** The real GraphQL round trip a stale/cold `project-profile.ts` cache
 * needs -- queries the project's `Status` single-select field by name and
 * returns `null` when the board has no such field (an unusually-shaped
 * board), never throws for that case. This is the ONLY place in this
 * package that queries the Status field's option schema (id/name pairs);
 * `getProjectItems` above queries item *field values* by name, a different
 * concern entirely (it needs no schema, just whatever value each item
 * already carries). */
async function fetchStatusFieldSchema(
  projectOwnerLogin: string,
  projectNumber: number,
  projectOwnerType: ProjectOwnerType,
  deps: GithubClientDeps,
): Promise<{ id: string; name: string; options: Array<{ id: string; name: string }> } | null> {
  const projectId = await resolveProjectNodeId(projectOwnerLogin, projectNumber, projectOwnerType, deps);
  const data = await githubGraphQL<GetStatusFieldSchemaResponse>(GET_STATUS_FIELD_SCHEMA_QUERY, { projectId }, {}, deps);
  return data.node?.field ?? null;
}

/** gdlc#199/#206: read the durable, XDG-cached Status-field profile for a
 * project (see `project-profile.ts`), refreshing it via a live GraphQL
 * query only when the cache is missing or past its TTL -- callers that
 * need to know a board's REAL Status options (and which documented
 * CLAUDE.md lifecycle stages have no matching option) should call this
 * instead of re-querying the field schema themselves or assuming a
 * uniform 5-stage lifecycle exists on every board. */
export async function getProjectStatusProfile(
  input: GetProjectStatusProfileInput,
  deps: GithubClientDeps = {},
): Promise<ProjectProfile> {
  const projectOwnerType = input.projectOwnerType ?? 'organization';
  return getOrRefreshProjectProfile(input.projectOwnerLogin, input.projectNumber, () =>
    fetchStatusFieldSchema(input.projectOwnerLogin, input.projectNumber, projectOwnerType, deps),
  );
}
