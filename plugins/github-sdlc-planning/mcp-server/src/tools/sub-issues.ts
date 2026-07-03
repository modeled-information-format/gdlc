import { githubGraphQL, type GithubClientDeps } from '../github-client.js';
import { resolveIssueNodeId } from '../resolvers.js';
import { PlanningError } from '../errors.js';

export const MAX_SUB_ISSUES_PER_PARENT = 100;
export const MAX_NESTING_LEVELS = 8;

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

const SUB_ISSUES_SUMMARY_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on Issue { subIssuesSummary { total } }
    }
  }
`;

interface SubIssuesSummaryResponse {
  node: { subIssuesSummary?: { total: number } } | null;
}

const ISSUE_PARENT_QUERY = `
  query($id: ID!) {
    node(id: $id) {
      ... on Issue { parent { id } }
    }
  }
`;

interface IssueParentResponse {
  node: { parent?: { id: string } | null } | null;
}

/** Level 1 = a top-level (no parent) issue. Walks the parent chain by node
 * ID only, so it works across repos without extra owner/repo bookkeeping.
 * Bounded to MAX_NESTING_LEVELS + 2 hops: enough to detect "already at or
 * past the limit" without walking an unbounded (and, per GitHub's own
 * constraint, impossible) chain. */
async function computeIssueLevel(nodeId: string, deps: GithubClientDeps): Promise<number> {
  let level = 1;
  let currentId: string | null = nodeId;
  let hops = 0;
  while (currentId !== null && hops <= MAX_NESTING_LEVELS + 1) {
    const response: IssueParentResponse = await githubGraphQL<IssueParentResponse>(
      ISSUE_PARENT_QUERY,
      { id: currentId },
      {},
      deps,
    );
    const parent: { id: string } | null = response.node?.parent ?? null;
    if (parent === null) break;
    level += 1;
    currentId = parent.id;
    hops += 1;
  }
  return level;
}

const ADD_SUB_ISSUE_MUTATION = `
  mutation($issueId: ID!, $subIssueId: ID!, $replaceParent: Boolean) {
    addSubIssue(input: { issueId: $issueId, subIssueId: $subIssueId, replaceParent: $replaceParent }) {
      issue { id }
      subIssue { id }
    }
  }
`;

/** AC-2: reject with `limit_exceeded` before forwarding to GitHub if the
 * parent already has 100 sub-issues or the resulting hierarchy would exceed
 * 8 nesting levels. Edge Case: concurrent re-parenting uses replaceParent. */
export async function addSubIssue(input: AddSubIssueInput, deps: GithubClientDeps = {}): Promise<AddSubIssueResult> {
  const parentNodeId = await resolveIssueNodeId(input.owner, input.repo, input.parentNumber, deps);
  const childNodeId = await resolveIssueNodeId(
    input.childOwner ?? input.owner,
    input.childRepo ?? input.repo,
    input.childNumber,
    deps,
  );

  const [summary, parentLevel] = await Promise.all([
    githubGraphQL<SubIssuesSummaryResponse>(SUB_ISSUES_SUMMARY_QUERY, { id: parentNodeId }, {}, deps),
    computeIssueLevel(parentNodeId, deps),
  ]);

  const currentSubIssueCount = summary.node?.subIssuesSummary?.total ?? 0;
  if (currentSubIssueCount >= MAX_SUB_ISSUES_PER_PARENT) {
    throw new PlanningError('limit_exceeded', `Parent issue already has ${currentSubIssueCount} sub-issues (limit ${MAX_SUB_ISSUES_PER_PARENT})`, {
      limit: 'max_sub_issues_per_parent',
      current: currentSubIssueCount,
      max: MAX_SUB_ISSUES_PER_PARENT,
    });
  }
  if (parentLevel >= MAX_NESTING_LEVELS) {
    throw new PlanningError(
      'limit_exceeded',
      `Adding this sub-issue would place it at nesting level ${parentLevel + 1}, exceeding the ${MAX_NESTING_LEVELS}-level limit`,
      { limit: 'max_nesting_levels', parentLevel, max: MAX_NESTING_LEVELS },
    );
  }

  await githubGraphQL(
    ADD_SUB_ISSUE_MUTATION,
    { issueId: parentNodeId, subIssueId: childNodeId, replaceParent: input.replaceParent ?? true },
    {},
    deps,
  );

  return { parentNodeId, childNodeId, replacedParent: input.replaceParent ?? true };
}

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

const LIST_SUB_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        subIssuesSummary { total completed percentCompleted }
        subIssues(first: 100) {
          nodes { id number title state }
        }
      }
    }
  }
`;

interface ListSubIssuesResponse {
  repository: {
    issue: {
      subIssuesSummary: { total: number; completed: number; percentCompleted: number };
      subIssues: { nodes: Array<{ id: string; number: number; title: string; state: string }> };
    };
  };
}

export interface ListSubIssuesResult {
  total: number;
  completed: number;
  percentCompleted: number;
  items: SubIssueSummaryItem[];
}

export async function listSubIssues(input: ListSubIssuesInput, deps: GithubClientDeps = {}): Promise<ListSubIssuesResult> {
  const data = await githubGraphQL<ListSubIssuesResponse>(
    LIST_SUB_ISSUES_QUERY,
    { owner: input.owner, repo: input.repo, number: input.parentNumber },
    {},
    deps,
  );
  const { subIssuesSummary, subIssues } = data.repository.issue;
  return {
    total: subIssuesSummary.total,
    completed: subIssuesSummary.completed,
    percentCompleted: subIssuesSummary.percentCompleted,
    items: subIssues.nodes.map((n) => ({ number: n.number, nodeId: n.id, title: n.title, state: n.state })),
  };
}
