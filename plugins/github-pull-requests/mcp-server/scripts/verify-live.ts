#!/usr/bin/env tsx
/**
 * Live verification script (assumption #3 / build-plan step 9): exercises
 * the real src/ implementation against a real GitHub repo, not a mock. Not
 * part of the CI-gating `npm test` suite — invoked by
 * .github/workflows/live-integration-tests.yml, or manually with a real
 * token and a sandbox repo you control.
 *
 * Creates a real issue + a real PR (via the Contents API, so no local git
 * needed) whose body closes that issue, then exercises get_linked_issues
 * (AC-3, the real closingIssuesReferences path), list_review_requests, and
 * — only when SANDBOX_REVIEWER_LOGIN is set to a real collaborator other
 * than the PR author — request_review / remove_review_request (AC-1/AC-2).
 * Cleans up by closing the PR and the issue.
 */
import { githubRest, type GithubClientDeps } from '../src/github-client.js';
import { requestReview, listReviewRequests, removeReviewRequest } from '../src/tools/reviews.js';
import { getLinkedIssues } from '../src/tools/linked-issues.js';

const OWNER = process.env.SANDBOX_OWNER ?? 'modeled-information-format';
const REPO = process.env.SANDBOX_REPO ?? 'gdlc-sandbox';
const REVIEWER_LOGIN = process.env.SANDBOX_REVIEWER_LOGIN;
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
interface CreatedPull {
  number: number;
}

async function createIssueViaRest(deps: GithubClientDeps): Promise<CreatedIssue> {
  return (await githubRest(
    `/repos/${OWNER}/${REPO}/issues`,
    { method: 'POST', body: { title: `[verify-live ${RUN_ID}] pull-requests target issue`, body: 'Safe to delete.' } },
    deps,
  )) as CreatedIssue;
}

async function createPullViaContentsApi(deps: GithubClientDeps, issueNumber: number): Promise<CreatedPull> {
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
  return (await githubRest(
    `/repos/${OWNER}/${REPO}/pulls`,
    {
      method: 'POST',
      body: {
        title: `[verify-live ${RUN_ID}]`,
        head: branch,
        base: 'main',
        body: `Fixes #${issueNumber}\n\nSafe to close/delete.`,
      },
    },
    deps,
  )) as CreatedPull;
}

async function main(): Promise<void> {
  const deps: GithubClientDeps = {};

  step('setup: create issue + PR that closes it');
  const issue = await createIssueViaRest(deps);
  const pr = await createPullViaContentsApi(deps, issue.number);
  process.stdout.write(`  issue #${issue.number}, PR #${pr.number}\n`);

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

  step('cleanup');
  await githubRest(`/repos/${OWNER}/${REPO}/pulls/${pr.number}`, { method: 'PATCH', body: { state: 'closed' } }, deps);
  await githubRest(`/repos/${OWNER}/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed' } }, deps);
  process.stdout.write(`  closed PR #${pr.number} and issue #${issue.number}\n`);

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
