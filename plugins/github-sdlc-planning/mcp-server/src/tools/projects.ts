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

const FIND_ITEM_BY_CONTENT_QUERY = `
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content {
              ... on Issue { number repository { nameWithOwner } }
              ... on PullRequest { number repository { nameWithOwner } }
            }
          }
        }
      }
    }
  }
`;

interface FindItemNode {
  id: string;
  content: { number?: number; repository?: { nameWithOwner?: string } } | null;
}

interface FindItemByContentResponse {
  node: { items?: { pageInfo?: { hasNextPage: boolean; endCursor: string | null }; nodes: FindItemNode[] } } | null;
}

/** gdlc#282: this existing-item check used to query the issue's own
 * `projectItems` connection (`repository(owner,repo){issue(number){
 * projectItems{...}}}`), the same issue-side lookup #273/#283 already
 * proved unreliable -- confirmed live to silently omit items on a project
 * owned by a different entity than the issue's own repo (`totalCount: 1`
 * on the issue side, listing only one project, while the other project's
 * item demonstrably existed via a direct `ProjectV2.items` query). That
 * made this idempotency check fail to find an item that was already there,
 * so a second `add_item_to_project` call for the same issue/project always
 * returned `existed: false` and created a duplicate.
 *
 * Copilot review finding: an earlier revision reused `getProjectItems`'s
 * `fetchAllProjectItemNodes` (which fetches every item's `fieldValues` and
 * always collects the whole board before returning) -- wasteful for an
 * idempotency check that only needs `content.number`/`repository` and can
 * stop as soon as it finds a match. This is its own dedicated,
 * fieldValues-free, stop-on-first-match paginated scan instead, mirroring
 * github-bug-capture's `findProjectItemForContent` (gdlc#273/#283) rather
 * than `getProjectItems`'s collect-everything shape. Matches
 * case-insensitively (gdlc#283's Copilot finding: GraphQL accepts
 * mixed-case owner/repo but `nameWithOwner` returns canonical casing), and
 * carries the same `MAX_PAGES`-bounded, stuck-cursor-guarded, malformed-
 * response handling as `fetchAllProjectItemNodes` below, for the same
 * reason: a malformed or looping GraphQL response must throw loudly, not
 * hang or silently truncate. */
async function findExistingItemId(
  projectId: string,
  owner: string,
  repo: string,
  issueNumber: number,
  deps: GithubClientDeps,
): Promise<string | null> {
  const target = `${owner}/${repo}`.toLowerCase();
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data: FindItemByContentResponse = await githubGraphQL<FindItemByContentResponse>(
      FIND_ITEM_BY_CONTENT_QUERY,
      { projectId, after },
      {},
      deps,
    );
    const items = data.node?.items;
    if (items === undefined) return null; // no `items` at all: project not found / no access
    const match = (items.nodes ?? []).find(
      (n) => n.content?.number === issueNumber && n.content?.repository?.nameWithOwner?.toLowerCase() === target,
    );
    if (match) return match.id;
    if (items.pageInfo === undefined) {
      throw new Error(`findExistingItemId: malformed response -- items present but pageInfo missing (projectId=${projectId})`);
    }
    if (!items.pageInfo.hasNextPage) return null;
    if (items.pageInfo.endCursor === after) {
      throw new Error(`findExistingItemId: malformed response -- hasNextPage true but endCursor did not advance (projectId=${projectId})`);
    }
    after = items.pageInfo.endCursor;
  }
  throw new Error(`findExistingItemId: exceeded ${MAX_PAGES} pages without hasNextPage becoming false (projectId=${projectId})`);
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

  const existingItemId = await findExistingItemId(projectId, input.owner, input.repo, input.issueNumber, deps);
  if (existingItemId) {
    return { itemId: existingItemId, existed: true };
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
      // Optional (not required): the query always requests it, but a
      // malformed/unexpected real-world response is exactly the case
      // fetchAllProjectItemNodes's own defensive check below exists to
      // catch -- typing it as always-present would defeat that check.
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
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
    if (items === undefined) return allNodes; // no `items` at all: project not found / no access, nothing to paginate
    // Copilot review finding: `items` can be present with `pageInfo`
    // missing/undefined on a malformed or unexpected GraphQL response --
    // `items.pageInfo.hasNextPage` would throw a confusing TypeError in
    // that case. Since this function's whole purpose is to never silently
    // truncate, a missing `pageInfo` on a page that DID return items is
    // treated as a malformed response and throws a clear, named error
    // rather than either crashing opaquely or guessing "no next page."
    if (items.pageInfo === undefined) {
      throw new Error(`fetchAllProjectItemNodes: malformed response -- items present but pageInfo missing (projectId=${projectId})`);
    }
    if (!items.pageInfo.hasNextPage) return allNodes;
    // gdlc#283 round-2 finding (back-ported here since #282 gives this
    // function a second caller): hasNextPage:true with a null or unchanged
    // endCursor would otherwise re-fetch the same page until MAX_PAGES is
    // hit, burning API quota instead of surfacing the malformed response
    // immediately. A legitimate next page always advances the cursor.
    if (items.pageInfo.endCursor === after) {
      throw new Error(
        `fetchAllProjectItemNodes: malformed response -- hasNextPage true but endCursor did not advance (projectId=${projectId})`,
      );
    }
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
