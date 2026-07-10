import { githubGraphQL, githubRest, type GithubClientDeps } from '../github-client.js';
import { isPrError } from '../errors.js';
import { loadGdlcConfig, resolvePrLifecycleConfig } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/config';

/** Issue #185/#188: the single source of truth for "is this PR actually
 * ready for merge/human review" -- checks, review state, review-thread
 * resolution, and code-scanning alerts, all together, in one call. Built to
 * replace ad hoc hand-written bash Monitor scripts, which had proven
 * unreliable in practice (silently never triggering, or only checking
 * one signal like CI status while unresolved review threads sat unseen --
 * exactly the failure this workspace's own history already hit twice on
 * unrelated PRs before this tool existed).
 *
 * `assessPrReadiness` is a pure function over injected fetchers -- no
 * `githubRest`/`githubGraphQL` call lives here directly -- so the three
 * required scenarios (checks pending, checks green but threads unresolved,
 * fully settled) are testable with canned fixtures and no network. The
 * real fetchers (`createLiveReadinessDeps`) are the only place that talks
 * to GitHub, used by both the MCP tool below and `scripts/pr-readiness.ts`. */

export interface PrReadinessRef {
  owner: string;
  repo: string;
  pullNumber: number;
}

export type CheckState = 'pending' | 'success' | 'failure';

export interface CheckStatus {
  name: string;
  state: CheckState;
}

export interface ReviewStatus {
  author: string;
  state: string;
}

export interface ReviewThreadStatus {
  isResolved: boolean;
}

export type CodeScanningAlertState = 'open' | 'dismissed' | 'fixed';

export interface CodeScanningAlert {
  state: CodeScanningAlertState;
}

export interface PrReadinessDeps {
  fetchChecks: (ref: PrReadinessRef) => Promise<CheckStatus[]>;
  fetchReviews: (ref: PrReadinessRef) => Promise<ReviewStatus[]>;
  fetchReviewThreads: (ref: PrReadinessRef) => Promise<ReviewThreadStatus[]>;
  fetchCodeScanningAlerts: (ref: PrReadinessRef) => Promise<CodeScanningAlert[]>;
}

export interface PrReadinessResult {
  settled: boolean;
  checks: { total: number; pending: number; failing: number; passing: number };
  reviews: { total: number; states: string[] };
  threads: { total: number; unresolved: number };
  codeScanningAlerts: { total: number; open: number };
  reasons: string[];
}

export interface PrReadinessOptions {
  /** Mirrors `prLifecycle.requireCleanCodeScanning` (config.ts's
   * `resolvePrLifecycleConfig`) -- true by default, matching that
   * function's own default. `false` skips fetching code-scanning alerts
   * entirely (not merely ignoring the result), so a repo without GitHub
   * Advanced Security enabled, or one that has explicitly opted out of this
   * gate, pays no extra REST round trip for it. */
  requireCleanCodeScanning?: boolean;
}

/** Settled requires, all at once: every check has actually passed (not
 * merely present -- a `pending` check is not "absent," it still blocks);
 * at least one non-empty review exists (a caller wanting a specific
 * reviewer, e.g. Copilot, filters `reviews.states`/checks review authors
 * itself -- this function stays reviewer-agnostic so it composes for any
 * PR, not just Copilot-reviewed ones); zero unresolved review threads;
 * zero OPEN code-scanning alerts (`dismissed`/`fixed` are fine -- an
 * explicitly dismissed alert is a resolved one, not an outstanding one),
 * unless `requireCleanCodeScanning: false`. */
export async function assessPrReadiness(
  ref: PrReadinessRef,
  deps: PrReadinessDeps,
  options: PrReadinessOptions = {},
): Promise<PrReadinessResult> {
  const requireCleanCodeScanning = options.requireCleanCodeScanning ?? true;
  const [checks, reviews, threads, alerts] = await Promise.all([
    deps.fetchChecks(ref),
    deps.fetchReviews(ref),
    deps.fetchReviewThreads(ref),
    requireCleanCodeScanning ? deps.fetchCodeScanningAlerts(ref) : Promise.resolve([]),
  ]);

  const pending = checks.filter((c) => c.state === 'pending').length;
  const failing = checks.filter((c) => c.state === 'failure').length;
  const passing = checks.filter((c) => c.state === 'success').length;
  // Copilot review finding: a GraphQL `PullRequestReview` in state PENDING
  // is a draft the querying user (i.e. this token's identity) hasn't
  // submitted yet -- not a completed review by anyone. Counting it toward
  // "at least one review exists" would report a PR as reviewed when no
  // review has actually landed. Excluded from both the settled check and
  // the returned summary, not merely ignored in the count -- a caller
  // reading `reviews.states` should never see a review nobody has
  // published.
  const submittedReviews = reviews.filter((r) => r.state !== 'PENDING');
  const unresolvedThreads = threads.filter((t) => !t.isResolved).length;
  const openAlerts = alerts.filter((a) => a.state === 'open').length;

  const reasons: string[] = [];
  // Self-caught dogfooding this tool on its own PR (gdlc#193): a commit
  // pushed moments ago has no CheckRun/StatusContext yet -- CI hasn't
  // started, not "nothing required." `pending === 0 && failing === 0` was
  // true in that window purely because `checks` was empty, so the original
  // logic reported `settled: true` on a PR whose CI had not run at all --
  // exactly the false-positive this tool exists to prevent. Zero checks
  // reported is never treated as "no checks required"; a repo that
  // genuinely runs no CI on PRs is out of scope for this heuristic.
  if (checks.length === 0) reasons.push('no checks reported yet');
  if (pending > 0) reasons.push(`${pending} check(s) still pending`);
  if (failing > 0) reasons.push(`${failing} check(s) failing`);
  if (submittedReviews.length === 0) reasons.push('no reviews yet');
  if (unresolvedThreads > 0) reasons.push(`${unresolvedThreads} unresolved review thread(s)`);
  if (requireCleanCodeScanning && openAlerts > 0) reasons.push(`${openAlerts} open code-scanning alert(s)`);

  return {
    settled: reasons.length === 0,
    checks: { total: checks.length, pending, failing, passing },
    reviews: { total: submittedReviews.length, states: submittedReviews.map((r) => r.state) },
    threads: { total: threads.length, unresolved: unresolvedThreads },
    codeScanningAlerts: { total: alerts.length, open: openAlerts },
    reasons,
  };
}

interface CheckRunContext {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
}

interface StatusContextNode {
  __typename: 'StatusContext';
  context: string;
  state: string;
}

type RollupContext = CheckRunContext | StatusContextNode;

interface PrReadinessGraphQLResponse {
  repository: {
    pullRequest: {
      headRefName: string;
      commits: { nodes: Array<{ commit: { statusCheckRollup: { contexts: { nodes: RollupContext[] } } | null } }> };
      reviews: { nodes: Array<{ author: { login: string } | null; state: string }> };
      reviewThreads: { nodes: Array<{ isResolved: boolean }> };
    } | null;
  } | null;
}

const PR_READINESS_QUERY = `
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        headRefName
        commits(last: 1) {
          nodes {
            commit {
              statusCheckRollup {
                contexts(first: 100) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion }
                    ... on StatusContext { context state }
                  }
                }
              }
            }
          }
        }
        reviews(first: 100) { nodes { author { login } state } }
        reviewThreads(first: 100) { nodes { isResolved } }
      }
    }
  }
`;

/** A `CheckRun`'s `status` is `QUEUED`/`IN_PROGRESS`/`COMPLETED`, with the
 * pass/fail verdict only meaningful once `COMPLETED`, in its separate
 * `conclusion` field (`SUCCESS`/`FAILURE`/`NEUTRAL`/`SKIPPED`/...) -- a
 * `StatusContext` (legacy commit-status API) instead reports one combined
 * `state` (`PENDING`/`SUCCESS`/`FAILURE`/`ERROR`). `NEUTRAL`/`SKIPPED` and
 * a legacy `SUCCESS`/`ERROR`-as-non-pending both count as passed, matching
 * `gh pr checks`' own bucket collapsing -- a required check that
 * intentionally no-ops on this PR (e.g. a path-filtered workflow) must not
 * permanently block `settled`. `ACTION_REQUIRED` (a required manual
 * approval/gate the check itself reports as unmet) and `STARTUP_FAILURE`
 * (the check runner never started) are real failures, not passes -- a
 * review-caught bug in an earlier revision of this function counted both as
 * `success` since it only matched `FAILURE`/`TIMED_OUT`/`CANCELLED`. */
const FAILING_CHECK_RUN_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

function classifyContext(ctx: RollupContext): CheckStatus {
  if (ctx.__typename === 'CheckRun') {
    if (ctx.status !== 'COMPLETED') return { name: ctx.name, state: 'pending' };
    const state: CheckState = ctx.conclusion !== null && FAILING_CHECK_RUN_CONCLUSIONS.has(ctx.conclusion) ? 'failure' : 'success';
    return { name: ctx.name, state };
  }
  // Legacy commit-status `StatusState`: EXPECTED means "reported as about to
  // run, no result yet" -- pending, not success (a second review-caught bug:
  // an earlier revision only treated PENDING as pending, so an EXPECTED
  // status context that never actually completes would have counted as
  // passed).
  const state: CheckState =
    ctx.state === 'PENDING' || ctx.state === 'EXPECTED' ? 'pending' : ctx.state === 'FAILURE' || ctx.state === 'ERROR' ? 'failure' : 'success';
  return { name: ctx.context, state };
}

interface RestCodeScanningAlert {
  state: 'open' | 'dismissed' | 'fixed';
}

/** Real fetchers backing `check_pr_readiness`/`scripts/pr-readiness.ts` --
 * the only place in this module that talks to GitHub. Checks, reviews,
 * review-thread resolution, AND the head ref (needed to scope the
 * code-scanning-alerts REST call below) all come from the one memoized
 * GraphQL round trip -- an earlier revision issued a second REST call
 * (`GET .../pulls/:pr`) just to read `head.ref`, tripling this function's
 * per-poll request count for no reason once a Monitor loop is calling it
 * every ~30s. Code-scanning alerts are REST-only (no GraphQL surface exists
 * for them), so that one call remains. */
export function createLiveReadinessDeps(deps: GithubClientDeps = {}): PrReadinessDeps {
  // `assessPrReadiness` calls fetchChecks/fetchReviews/fetchReviewThreads
  // concurrently via Promise.all, and all three read fields off the same
  // `pullRequest` GraphQL query -- without memoizing per ref, that would
  // fire three identical round trips instead of one. Cache the in-flight
  // promise itself (not just its resolved value), keyed by ref, so
  // concurrent callers for the same ref share one request; a later ref
  // (a different PR) still gets its own fresh fetch.
  const inFlight = new Map<string, Promise<PrReadinessGraphQLResponse['repository']>>();
  function fetchPrFields(ref: PrReadinessRef): Promise<PrReadinessGraphQLResponse['repository']> {
    const key = `${ref.owner}/${ref.repo}#${ref.pullNumber}`;
    let promise = inFlight.get(key);
    if (!promise) {
      promise = githubGraphQL<PrReadinessGraphQLResponse>(
        PR_READINESS_QUERY,
        { owner: ref.owner, repo: ref.repo, pr: ref.pullNumber },
        deps,
      ).then((data) => data.repository);
      inFlight.set(key, promise);
    }
    return promise;
  }

  return {
    async fetchChecks(ref) {
      const repository = await fetchPrFields(ref);
      const contexts = repository?.pullRequest?.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
      return contexts.map(classifyContext);
    },
    async fetchReviews(ref) {
      const repository = await fetchPrFields(ref);
      const nodes = repository?.pullRequest?.reviews.nodes ?? [];
      return nodes.map((n) => ({ author: n.author?.login ?? 'ghost', state: n.state }));
    },
    async fetchReviewThreads(ref) {
      const repository = await fetchPrFields(ref);
      return repository?.pullRequest?.reviewThreads.nodes ?? [];
    },
    async fetchCodeScanningAlerts(ref) {
      const repository = await fetchPrFields(ref);
      const headRefName = repository?.pullRequest?.headRefName;
      if (headRefName === undefined) return [];
      let alerts: RestCodeScanningAlert[];
      try {
        alerts = (await githubRest(
          // Copilot review finding: a branch name can contain characters
          // (#, spaces, ...) that are significant in a query string --
          // unencoded, they truncate/corrupt the `ref` param and either
          // fail the request or silently query the wrong ref.
          `/repos/${ref.owner}/${ref.repo}/code-scanning/alerts?ref=${encodeURIComponent(`refs/heads/${headRefName}`)}&per_page=100`,
          {},
          deps,
        )) as RestCodeScanningAlert[];
      } catch (err) {
        // A review-caught bug in an earlier revision caught every error here
        // (auth failures, rate limits, network errors included) and reported
        // zero alerts -- silently telling `settled` a PR has no open
        // code-scanning findings when the fetch actually failed, exactly the
        // kind of masked failure this tool exists to prevent. The ONE real
        // "zero alerts" case is a 404: GitHub Advanced Security / code
        // scanning is not enabled on this repo at all, which is not an
        // error condition for a repo that never opted into it. Every other
        // status (403 token/permission issues -- this workspace has hit a
        // wrong-token-type 403 on this exact endpoint before -- 429 rate
        // limits, 5xx) must propagate so the caller sees a real failure
        // instead of a false "clean" verdict.
        if (isPrError(err) && err.details.status === 404) {
          alerts = [];
        } else {
          throw err;
        }
      }
      return alerts.map((a) => ({ state: a.state }));
    },
  };
}

/** Resolves `prLifecycle.requireCleanCodeScanning` from the layered gdlc
 * config (project layer, then global) the same way every other
 * config-consuming MCP tool in this plugin suite does: via the mcp-server's
 * own `file:` dependency on `@github-sdlc-plugins/github-sdlc-planning-mcp-server`
 * (a plain-utility import, not the dependency-free constraint hooks are
 * under -- see docs/reference/config-schema.md's "Where the loader lives").
 * A review-caught bug in an earlier revision defined this toggle in the
 * schema and documented it but never actually read it here, so it had no
 * effect on `check_pr_readiness`'s verdict regardless of how it was set. */
export async function checkPrReadiness(ref: PrReadinessRef, deps: GithubClientDeps = {}): Promise<PrReadinessResult> {
  const config = resolvePrLifecycleConfig(loadGdlcConfig());
  return assessPrReadiness(ref, createLiveReadinessDeps(deps), { requireCleanCodeScanning: config.requireCleanCodeScanning });
}
