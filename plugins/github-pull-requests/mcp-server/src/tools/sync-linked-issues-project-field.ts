import { githubRest, type GithubClientDeps } from '../github-client.js';
import { PrError } from '../errors.js';
import { getLinkedIssues } from './linked-issues.js';
import type { PullRequestRef } from './reviews.js';
import {
  getProjectItems,
  setFieldValue,
  type FieldValueInput,
} from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/tools/projects';
import type { ProjectOwnerType } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/resolvers';

export interface SyncLinkedIssuesProjectFieldInput extends PullRequestRef {
  projectOwnerLogin: string;
  projectNumber: number;
  projectOwnerType?: ProjectOwnerType;
  fieldId: string;
  value: FieldValueInput;
}

/** Known limitation: get_project_items' `items(first: 100)` query has no
 * pagination cursor, so a board with more than 100 items can report a
 * genuinely-linked issue as notFoundOnBoard when it's simply outside the
 * first page. Fixing this means adding cursor-based pagination to
 * get_project_items in the github-sdlc-planning package — a change shared
 * by that package's own get_project_items MCP tool and session.ts, out of
 * scope for this pass. Treat notFoundOnBoard as "not found on the first 100
 * items", not an absolute guarantee, until that's fixed. */
export interface SyncLinkedIssuesProjectFieldResult {
  synced: Array<{ issueNumber: number; itemId: string }>;
  notFoundOnBoard: number[];
  /** Closing issues in a *different* repo than the PR — get_linked_issues
   * can return these (a PR can close an issue in another repo via
   * closingIssuesReferences). A Projects v2 board can also hold items from
   * multiple repos, so board-item matches are checked against
   * get_project_items' `repo` field too, not `number` alone. Cross-repo
   * closing issues are skipped rather than risked as a silent
   * wrong-item write. */
  skippedCrossRepo: number[];
}

interface RestPullMergedState {
  merged: boolean;
}

async function assertPullMerged(ref: PullRequestRef, deps: GithubClientDeps): Promise<void> {
  const pr = (await githubRest(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}`, {}, deps)) as RestPullMergedState;
  if (!pr.merged) {
    throw new PrError('not_merged', `PR #${ref.pullNumber} in ${ref.owner}/${ref.repo} is not merged yet`, {
      pullNumber: ref.pullNumber,
    });
  }
}

/** Codes a PlanningError can carry that mean the same thing in this plugin's
 * own PrErrorCode union — preserved as-is rather than collapsed, since they
 * describe a distinct condition a caller needs to react to differently
 * (e.g. missing_scope means "run gh auth login", not "a lookup failed"). */
const PRESERVABLE_CODES = new Set(['missing_scope', 'github_api_error', 'rate_limited']);

function isPreservablePlanningError(err: unknown): err is { code: string; message: string; details: Record<string, unknown> } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'details' in err &&
    typeof (err as { code: unknown }).code === 'string' &&
    PRESERVABLE_CODES.has((err as { code: string }).code)
  );
}

/** Wraps the two imported github-sdlc-planning calls so a PlanningError
 * never escapes this plugin's error shape and skips isPrError() in
 * index.ts (same pattern as pr-projects.ts's resolveProjectId) — but
 * preserves a distinct, meaningful code (missing_scope, github_api_error,
 * rate_limited) instead of collapsing every failure into resolve_id_failed,
 * which would misclassify those and make it harder for a caller to react
 * correctly. Only genuine lookup/translation failures (e.g.
 * resolve_project_id) fall back to resolve_id_failed. */
async function callPlanningTool<T>(lookupStep: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    if (isPreservablePlanningError(cause)) {
      throw new PrError(cause.code as 'missing_scope' | 'github_api_error' | 'rate_limited', cause.message, cause.details);
    }
    throw new PrError('resolve_id_failed', `Projects v2 sync step "${lookupStep}" failed`, {
      lookupStep,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** GitHub owner/repo names are case-insensitive for routing purposes, but
 * nothing guarantees a caller (or GraphQL's nameWithOwner) supplies matching
 * case — compare case-insensitively so a caller-supplied owner/repo that
 * differs only in case from GraphQL's canonical casing still matches. */
function sameRepo(a: string | null, b: string): boolean {
  return a !== null && a.toLowerCase() === b.toLowerCase();
}

/** A Projects v2 board can hold items from multiple repos, so `number` alone
 * is never a safe join key on either side of this match: get_linked_issues
 * can return a closing issue in a different repo than the PR (via
 * closingIssuesReferences), restricted here to same-repo-as-the-PR closing
 * issues only (cross-repo ones are reported in skippedCrossRepo, never
 * guessed at) — and symmetrically, a board can contain an item from an
 * unrelated repo that happens to share a same-repo closing issue's number,
 * so the board-item lookup below also compares get_project_items' `repo`
 * field, not `number` alone. */
export async function syncLinkedIssuesProjectField(
  input: SyncLinkedIssuesProjectFieldInput,
  deps: GithubClientDeps = {},
): Promise<SyncLinkedIssuesProjectFieldResult> {
  const ref: PullRequestRef = { owner: input.owner, repo: input.repo, pullNumber: input.pullNumber };
  await assertPullMerged(ref, deps);

  const linked = await getLinkedIssues(ref, deps);
  const prRepo = `${input.owner}/${input.repo}`;
  const closing = linked.items.filter((i) => i.closing);
  const closingIssueNumbers = closing.filter((i) => sameRepo(i.repo, prRepo)).map((i) => i.number);
  const skippedCrossRepo = closing.filter((i) => !sameRepo(i.repo, prRepo)).map((i) => i.number);

  const projectItems = await callPlanningTool('get_project_items', () =>
    getProjectItems(
      { projectOwnerLogin: input.projectOwnerLogin, projectNumber: input.projectNumber, projectOwnerType: input.projectOwnerType },
      deps,
    ),
  );

  const synced: Array<{ issueNumber: number; itemId: string }> = [];
  const notFoundOnBoard: number[] = [];

  for (const issueNumber of closingIssueNumbers) {
    const item = projectItems.items.find((i) => i.number === issueNumber && sameRepo(i.repo, prRepo));
    if (!item) {
      notFoundOnBoard.push(issueNumber);
      continue;
    }
    await callPlanningTool('set_field_value', () =>
      setFieldValue(
        {
          projectOwnerLogin: input.projectOwnerLogin,
          projectNumber: input.projectNumber,
          projectOwnerType: input.projectOwnerType,
          itemId: item.id,
          fieldId: input.fieldId,
          value: input.value,
        },
        deps,
      ),
    );
    synced.push({ issueNumber, itemId: item.id });
  }

  return { synced, notFoundOnBoard, skippedCrossRepo };
}
