#!/usr/bin/env tsx
/**
 * Live verification script (assumption #3 / build-plan step 9): exercises
 * the real src/ implementation against a real GitHub repo, not a mock. Not
 * part of the CI-gating `npm test` suite — invoked by
 * .github/workflows/live-integration-tests.yml, or manually with a real
 * token and a sandbox repo you control.
 *
 * Creates a real issue + a real PR (opened via create_pull_request itself,
 * not a raw REST call — the branch/commit still need a git-refs/Contents-API
 * setup step, since create_pull_request only opens the PR against an
 * existing head ref) whose body closes that issue, then exercises
 * get_linked_issues (AC-3, the real closingIssuesReferences path),
 * classify_pull_request, list_review_requests, and — only when
 * SANDBOX_REVIEWER_LOGIN is set to a real collaborator other than the PR
 * author — request_review / remove_review_request. When
 * SANDBOX_PROJECT_OWNER/SANDBOX_PROJECT_NUMBER/SANDBOX_FIELD_ID are all set,
 * also exercises add_pull_request_to_project, merges the PR, and exercises
 * sync_linked_issues_project_field, asserting the linked issue's project
 * field actually changed. Cleans up by closing (or, if merged, leaving
 * merged) the PR and closing the issue.
 */
import { githubRest, type GithubClientDeps } from '../src/github-client.js';
import { requestReview, listReviewRequests, removeReviewRequest } from '../src/tools/reviews.js';
import { getLinkedIssues } from '../src/tools/linked-issues.js';
import { createPullRequest } from '../src/tools/create-pull-request.js';
import { classifyPullRequest } from '../src/tools/classify-pull-request.js';
import { addPullRequestToProject } from '../src/tools/pr-projects.js';
import { syncLinkedIssuesProjectField } from '../src/tools/sync-linked-issues-project-field.js';
import { getProjectItems } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/tools/projects';
import type { ProjectOwnerType } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/resolvers';

const OWNER = process.env.SANDBOX_OWNER ?? 'modeled-information-format';
const REPO = process.env.SANDBOX_REPO ?? 'gdlc-sandbox';
const REVIEWER_LOGIN = process.env.SANDBOX_REVIEWER_LOGIN;
const PROJECT_OWNER = process.env.SANDBOX_PROJECT_OWNER;
// Number('') would already fall through the `? :` above, but a non-numeric
// value (e.g. SANDBOX_PROJECT_NUMBER="abc") produces NaN, which is not
// `undefined` — the project-coupling block's `!== undefined` guard would
// then proceed with a NaN project number instead of skipping cleanly.
const rawProjectNumber = process.env.SANDBOX_PROJECT_NUMBER ? Number(process.env.SANDBOX_PROJECT_NUMBER) : undefined;
const PROJECT_NUMBER = rawProjectNumber !== undefined && Number.isFinite(rawProjectNumber) ? rawProjectNumber : undefined;
const PROJECT_OWNER_TYPE = (process.env.SANDBOX_PROJECT_OWNER_TYPE as ProjectOwnerType | undefined) ?? 'organization';
const FIELD_ID = process.env.SANDBOX_FIELD_ID;
const RUN_ID = process.env.GITHUB_RUN_ID ?? String(Date.now());

let failed = false;
function assert(condition: boolean, message: string): void {
  if (condition) {
    process.stdout.write(`  OK   ${message}\n`);
  } else {
    failed = true;
    process.stdout.write(`  FAIL ${message}\n`);
  }
}
function step(name: string): void {
  process.stdout.write(`\n=== ${name} ===\n`);
}

/** GitHub parses a PR body's "Fixes #N" into closingIssuesReferences
 * asynchronously after PR creation -- observed live: absent immediately
 * after creation, present when checked manually a few minutes later. The
 * exact typical delay isn't known from a single manual observation, so the
 * default window here (attempts/delayMs) is sized generously rather than to
 * a precise measured figure (same eventual-consistency pattern already
 * found in the planning package's Projects v2 read-after-write, but that
 * one resolved within ~1s, so its narrower default is kept as-is and this
 * call site overrides both params explicitly). */
async function retryUntil<T>(fn: () => Promise<T>, isReady: (result: T) => boolean, attempts = 5, delayMs = 1000): Promise<T> {
  let result = await fn();
  for (let i = 1; i < attempts && !isReady(result); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    result = await fn();
  }
  return result;
}

interface CreatedIssue {
  number: number;
}
interface RefResponse {
  object: { sha: string };
}

async function createIssueViaRest(deps: GithubClientDeps): Promise<CreatedIssue> {
  return (await githubRest(
    `/repos/${OWNER}/${REPO}/issues`,
    { method: 'POST', body: { title: `[verify-live ${RUN_ID}] pull-requests target issue`, body: 'Safe to delete.' } },
    deps,
  )) as CreatedIssue;
}

/** Only the branch/commit setup — the PR itself is opened via
 * create_pull_request (the tool under test), not a raw REST call. */
async function createBranchWithCommit(deps: GithubClientDeps): Promise<string> {
  const branch = `verify-live-${RUN_ID}`;
  const mainRef = (await githubRest(`/repos/${OWNER}/${REPO}/git/ref/heads/main`, {}, deps)) as RefResponse;
  await githubRest(`/repos/${OWNER}/${REPO}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: mainRef.object.sha } }, deps);
  await githubRest(
    `/repos/${OWNER}/${REPO}/contents/verify-live-${RUN_ID}.txt`,
    {
      method: 'PUT',
      body: {
        message: `verify-live ${RUN_ID}`,
        content: Buffer.from(`verify-live run ${RUN_ID}\n`).toString('base64'),
        branch,
      },
    },
    deps,
  );
  return branch;
}

async function main(): Promise<void> {
  const deps: GithubClientDeps = {};

  step('setup: create issue + PR that closes it (via create_pull_request)');
  const issue = await createIssueViaRest(deps);
  const branch = await createBranchWithCommit(deps);
  const pr = await createPullRequest(
    { owner: OWNER, repo: REPO, title: `[verify-live ${RUN_ID}]`, body: `Fixes #${issue.number}\n\nSafe to close/delete.`, baseRefName: 'main', headRefName: branch },
    deps,
  );
  assert(typeof pr.number === 'number' && pr.number > 0, 'create_pull_request returned a real PR number');
  process.stdout.write(`  issue #${issue.number}, PR #${pr.number}\n`);
  let merged = false;

  step('get_linked_issues (AC-3: closingIssuesReferences)');
  // 12 attempts, 5s apart: the first attempt is immediate (no delay), so
  // this sleeps for at most 11 * 5s = 55s total -- the closingIssuesReferences backfill
  // delay isn't precisely measured, so this errs generous rather than
  // risking a flaky failure on a correct-but-slow-to-populate link.
  const linked = await retryUntil(
    () => getLinkedIssues({ owner: OWNER, repo: REPO, pullNumber: pr.number }),
    (result) => result.items.some((i) => i.number === issue.number && i.source === 'closing_reference' && i.closing),
    12,
    5000,
  );
  assert(linked.sourceAttempted[0] === 'closing_reference', 'closing_reference attempted first');
  assert(
    linked.items.some((i) => i.number === issue.number && i.source === 'closing_reference' && i.closing),
    `get_linked_issues finds issue #${issue.number} via closingIssuesReferences`,
  );

  step('classify_pull_request');
  const classified = await classifyPullRequest({ owner: OWNER, repo: REPO, pullNumber: pr.number, type: 'test' });
  assert(classified.size === 'XS', `classify_pull_request buckets a 1-file, tiny diff as XS (got ${classified.size})`);
  assert(classified.labelsApplied.includes('type:test'), 'classify_pull_request applied type:test');
  assert(classified.labelsApplied.includes(`size:${classified.size}`), `classify_pull_request applied size:${classified.size}`);

  step('list_review_requests (empty state)');
  const empty = await listReviewRequests({ owner: OWNER, repo: REPO, pullNumber: pr.number });
  assert(empty.users.length === 0 && empty.teams.length === 0, 'no reviewers requested yet');

  if (REVIEWER_LOGIN !== undefined) {
    step('request_review + remove_review_request (AC-1/AC-2)');
    const requested = await requestReview({ owner: OWNER, repo: REPO, pullNumber: pr.number, reviewers: [REVIEWER_LOGIN] });
    assert(requested.users.includes(REVIEWER_LOGIN), `request_review added ${REVIEWER_LOGIN}`);
    const removed = await removeReviewRequest({ owner: OWNER, repo: REPO, pullNumber: pr.number, reviewers: [REVIEWER_LOGIN] });
    assert(!removed.users.includes(REVIEWER_LOGIN), `remove_review_request removed ${REVIEWER_LOGIN}`);
  } else {
    process.stdout.write('\n=== request_review / remove_review_request ===\n  SKIP (no SANDBOX_REVIEWER_LOGIN set)\n');
  }

  if (PROJECT_OWNER !== undefined && PROJECT_NUMBER !== undefined && FIELD_ID !== undefined) {
    step('add_pull_request_to_project');
    await addPullRequestToProject(
      { owner: OWNER, repo: REPO, pullNumber: pr.number, projectOwnerLogin: PROJECT_OWNER, projectNumber: PROJECT_NUMBER, projectOwnerType: PROJECT_OWNER_TYPE },
      deps,
    );
    assert(true, `add_pull_request_to_project added PR #${pr.number} to ${PROJECT_OWNER} project #${PROJECT_NUMBER}`);

    step('merge PR, then sync_linked_issues_project_field');
    await githubRest(`/repos/${OWNER}/${REPO}/pulls/${pr.number}/merge`, { method: 'PUT' }, deps);
    merged = true;
    const sync = await retryUntil(
      () =>
        syncLinkedIssuesProjectField(
          {
            owner: OWNER,
            repo: REPO,
            pullNumber: pr.number,
            projectOwnerLogin: PROJECT_OWNER,
            projectNumber: PROJECT_NUMBER,
            projectOwnerType: PROJECT_OWNER_TYPE,
            fieldId: FIELD_ID,
            value: { kind: 'text', text: `verify-live ${RUN_ID}` },
          },
          deps,
        ),
      (result) => result.synced.some((s) => s.issueNumber === issue.number),
      12,
      5000,
    );
    assert(
      sync.synced.some((s) => s.issueNumber === issue.number),
      `sync_linked_issues_project_field synced issue #${issue.number}'s project field`,
    );

    const items = await getProjectItems(
      { projectOwnerLogin: PROJECT_OWNER, projectNumber: PROJECT_NUMBER, projectOwnerType: PROJECT_OWNER_TYPE },
      deps,
    );
    const syncedItem = items.items.find((i) => i.number === issue.number);
    assert(
      syncedItem?.fieldValues.some((fv) => fv.text === `verify-live ${RUN_ID}`) ?? false,
      `linked issue #${issue.number}'s project item field reflects the synced value`,
    );
  } else {
    process.stdout.write(
      '\n=== add_pull_request_to_project / sync_linked_issues_project_field ===\n  SKIP (SANDBOX_PROJECT_OWNER/SANDBOX_PROJECT_NUMBER/SANDBOX_FIELD_ID not all set)\n',
    );
  }

  step('cleanup');
  if (!merged) {
    await githubRest(`/repos/${OWNER}/${REPO}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } }, deps);
  }
  await githubRest(`/repos/${OWNER}/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } }, deps);
  process.stdout.write(`  ${merged ? 'left merged' : 'closed'} PR #${pr.number}, closed issue #${issue.number}\n`);

  if (failed) {
    process.stdout.write('\nverify-live: FAILED\n');
    process.exit(1);
  }
  process.stdout.write('\nverify-live: PASSED\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`verify-live crashed: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
