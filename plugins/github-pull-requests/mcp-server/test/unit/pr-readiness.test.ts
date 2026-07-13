import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockGraphQL, mockRest } from '../helpers.js';
import {
  assessPrReadiness,
  checkPrReadiness,
  createLiveReadinessDeps,
  type PrReadinessDeps,
  type PrReadinessRef,
} from '../../src/tools/pr-readiness.js';

const REF: PrReadinessRef = { owner: 'acme', repo: 'widgets', pullNumber: 42 };

function deps(overrides: Partial<PrReadinessDeps>): PrReadinessDeps {
  return {
    fetchChecks: async () => [],
    fetchReviews: async () => [],
    fetchReviewThreads: async () => [],
    fetchCodeScanningAlerts: async () => [],
    ...overrides,
  };
}

describe('assessPrReadiness', () => {
  // Scenario 1: checks still pending.
  it('is not settled while any check is pending, even with clean reviews/threads/alerts', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [
          { name: 'build', state: 'pending' },
          { name: 'test', state: 'success' },
        ],
        fetchReviews: async () => [{ author: 'copilot-pull-request-reviewer', state: 'COMMENTED' }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.checks).toEqual({ total: 2, pending: 1, failing: 0, passing: 1 });
    expect(result.reasons).toContain('1 check(s) still pending');
  });

  // Scenario 2: checks green but review threads unresolved.
  it('is not settled when checks are green and reviewed, but a review thread is unresolved', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [{ name: 'build', state: 'success' }],
        fetchReviews: async () => [{ author: 'copilot-pull-request-reviewer', state: 'COMMENTED' }],
        fetchReviewThreads: async () => [{ isResolved: false }, { isResolved: true }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.threads).toEqual({ total: 2, unresolved: 1 });
    expect(result.reasons).toEqual(['1 unresolved review thread(s)']);
  });

  // Scenario 3: fully settled.
  it('is settled when checks pass, a review exists, no unresolved threads, and no open code-scanning alerts', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [
          { name: 'build', state: 'success' },
          { name: 'test', state: 'success' },
        ],
        fetchReviews: async () => [{ author: 'copilot-pull-request-reviewer', state: 'COMMENTED' }],
        fetchReviewThreads: async () => [{ isResolved: true }, { isResolved: true }],
        fetchCodeScanningAlerts: async () => [{ state: 'dismissed' }, { state: 'fixed' }],
      }),
    );
    expect(result.settled).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.checks).toEqual({ total: 2, pending: 0, failing: 0, passing: 2 });
    expect(result.reviews).toEqual({ total: 1, states: ['COMMENTED'] });
    expect(result.threads).toEqual({ total: 2, unresolved: 0 });
    expect(result.codeScanningAlerts).toEqual({ total: 2, open: 0 });
  });

  it('is not settled when a check has failed outright', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [{ name: 'build', state: 'failure' }],
        fetchReviews: async () => [{ author: 'x', state: 'APPROVED' }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.reasons).toContain('1 check(s) failing');
  });

  it('is not settled with zero reviews, even with green checks and no threads', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({ fetchChecks: async () => [{ name: 'build', state: 'success' }] }),
    );
    expect(result.settled).toBe(false);
    expect(result.reasons).toContain('no reviews yet');
  });

  it('is not settled with an open code-scanning alert, even otherwise clean', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [{ name: 'build', state: 'success' }],
        fetchReviews: async () => [{ author: 'x', state: 'APPROVED' }],
        fetchCodeScanningAlerts: async () => [{ state: 'open' }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.reasons).toContain('1 open code-scanning alert(s)');
  });

  // Self-caught dogfooding this tool on its own PR: a freshly-pushed commit
  // has no CheckRun/StatusContext reported yet, and zero checks was
  // originally (wrongly) treated the same as "nothing pending or failing" --
  // reporting settled: true on a PR whose CI had not even started.
  it('is NOT settled when zero checks are reported, even with a clean review/threads/alerts, because CI has not run', async () => {
    const result = await assessPrReadiness(REF, deps({ fetchReviews: async () => [{ author: 'x', state: 'APPROVED' }] }));
    expect(result.settled).toBe(false);
    expect(result.reasons).toContain('no checks reported yet');
  });

  // requireCleanCodeScanning: false (issue #185/#186's prLifecycle toggle) --
  // review-caught bug: an earlier revision defined and documented this
  // toggle but never actually consulted it here.
  it('ignores open code-scanning alerts and never calls fetchCodeScanningAlerts when requireCleanCodeScanning is false', async () => {
    let fetchCodeScanningAlertsCalled = false;
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [{ name: 'build', state: 'success' }],
        fetchReviews: async () => [{ author: 'x', state: 'APPROVED' }],
        fetchCodeScanningAlerts: async () => {
          fetchCodeScanningAlertsCalled = true;
          return [{ state: 'open' }];
        },
      }),
      { requireCleanCodeScanning: false },
    );
    expect(fetchCodeScanningAlertsCalled).toBe(false);
    expect(result.settled).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.codeScanningAlerts).toEqual({ total: 0, open: 0 });
  });

  it('still enforces code-scanning alerts by default when no options are passed', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [{ name: 'build', state: 'success' }],
        fetchReviews: async () => [{ author: 'x', state: 'APPROVED' }],
        fetchCodeScanningAlerts: async () => [{ state: 'open' }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.reasons).toContain('1 open code-scanning alert(s)');
  });

  it('reports every unmet condition together, not just the first', async () => {
    const result = await assessPrReadiness(
      REF,
      deps({
        fetchChecks: async () => [
          { name: 'build', state: 'pending' },
          { name: 'test', state: 'failure' },
        ],
        fetchReviewThreads: async () => [{ isResolved: false }],
        fetchCodeScanningAlerts: async () => [{ state: 'open' }],
      }),
    );
    expect(result.settled).toBe(false);
    expect(result.reasons).toEqual([
      '1 check(s) still pending',
      '1 check(s) failing',
      'no reviews yet',
      '1 unresolved review thread(s)',
      '1 open code-scanning alert(s)',
    ]);
  });
});

const GRAPHQL_FIELDS = {
  headRefName: 'feature-branch',
  commits: {
    nodes: [
      {
        commit: {
          statusCheckRollup: {
            contexts: {
              nodes: [
                { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
                { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', conclusion: null },
                { __typename: 'CheckRun', name: 'flaky', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
                { __typename: 'CheckRun', name: 'noop-skip', status: 'COMPLETED', conclusion: 'SKIPPED' },
                { __typename: 'StatusContext', context: 'legacy-ci', state: 'SUCCESS' },
                { __typename: 'StatusContext', context: 'legacy-pending', state: 'PENDING' },
                { __typename: 'StatusContext', context: 'legacy-failed', state: 'ERROR' },
              ],
            },
          },
        },
      },
    ],
  },
  reviews: {
    nodes: [
      { author: { login: 'copilot-pull-request-reviewer' }, state: 'COMMENTED' },
      { author: null, state: 'COMMENTED' },
    ],
  },
  reviewThreads: { nodes: [{ isResolved: true }, { isResolved: false }] },
};

describe('createLiveReadinessDeps: CheckRun/StatusContext classification', () => {
  it('classifies CheckRun and StatusContext contexts into pending/success/failure correctly', async () => {
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    const deps = createLiveReadinessDeps();
    const checks = await deps.fetchChecks({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(checks).toEqual([
      { name: 'build', state: 'success' },
      { name: 'lint', state: 'pending' }, // CheckRun not yet COMPLETED
      { name: 'flaky', state: 'failure' }, // COMPLETED + TIMED_OUT
      { name: 'noop-skip', state: 'success' }, // COMPLETED + SKIPPED counts as passed
      { name: 'legacy-ci', state: 'success' },
      { name: 'legacy-pending', state: 'pending' },
      { name: 'legacy-failed', state: 'failure' }, // StatusContext ERROR counts as failure
    ]);
  });

  it('treats ACTION_REQUIRED and STARTUP_FAILURE CheckRun conclusions as failing, not passing', async () => {
    mockGraphQL(() => ({
      repository: {
        pullRequest: {
          ...GRAPHQL_FIELDS,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      nodes: [
                        { __typename: 'CheckRun', name: 'gate', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
                        { __typename: 'CheckRun', name: 'runner', status: 'COMPLETED', conclusion: 'STARTUP_FAILURE' },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    }));
    const deps = createLiveReadinessDeps();
    const checks = await deps.fetchChecks({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(checks).toEqual([
      { name: 'gate', state: 'failure' },
      { name: 'runner', state: 'failure' },
    ]);
  });

  it('treats a StatusContext state of EXPECTED as pending, not success', async () => {
    mockGraphQL(() => ({
      repository: {
        pullRequest: {
          ...GRAPHQL_FIELDS,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: { nodes: [{ __typename: 'StatusContext', context: 'legacy-not-started', state: 'EXPECTED' }] },
                  },
                },
              },
            ],
          },
        },
      },
    }));
    const deps = createLiveReadinessDeps();
    const checks = await deps.fetchChecks({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(checks).toEqual([{ name: 'legacy-not-started', state: 'pending' }]);
  });

  it('maps a null review author to "ghost" rather than throwing', async () => {
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    const deps = createLiveReadinessDeps();
    const reviews = await deps.fetchReviews({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(reviews).toEqual([
      { author: 'copilot-pull-request-reviewer', state: 'COMMENTED' },
      { author: 'ghost', state: 'COMMENTED' },
    ]);
  });

  it('passes review-thread resolution through unchanged', async () => {
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    const deps = createLiveReadinessDeps();
    const threads = await deps.fetchReviewThreads({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(threads).toEqual([{ isResolved: true }, { isResolved: false }]);
  });

  it('fetches code-scanning alerts filtered by the PR head ref (from the memoized GraphQL response, no separate REST call)', async () => {
    let capturedUrl = '';
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/code-scanning/alerts', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([{ state: 'open' }, { state: 'dismissed' }]);
      }),
    );
    const deps = createLiveReadinessDeps();
    const alerts = await deps.fetchCodeScanningAlerts({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(alerts).toEqual([{ state: 'open' }, { state: 'dismissed' }]);
    // Parse and decode rather than substring-matching the raw URL -- this
    // assertion must hold whether or not `ref` is URL-encoded (Copilot
    // review finding: an encoded ref is correct behavior, not a test
    // failure).
    expect(new URL(capturedUrl).searchParams.get('ref')).toBe('refs/heads/feature-branch');
  });

  it('URL-encodes a head ref containing characters significant in a query string (Copilot review finding)', async () => {
    let capturedUrl = '';
    mockGraphQL(() => ({ repository: { pullRequest: { ...GRAPHQL_FIELDS, headRefName: 'fix/issue#42 & more' } } }));
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/code-scanning/alerts', ({ request }) => {
        capturedUrl = request.url;
        return HttpResponse.json([]);
      }),
    );
    const deps = createLiveReadinessDeps();
    await deps.fetchCodeScanningAlerts({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(new URL(capturedUrl).searchParams.get('ref')).toBe('refs/heads/fix/issue#42 & more');
  });

  it('treats a 404 (Advanced Security / code scanning not enabled on this repo) as zero alerts, not a thrown error', async () => {
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    server.use(http.get('https://api.github.com/repos/acme/widgets/code-scanning/alerts', () => HttpResponse.json({ message: 'no analysis found' }, { status: 404 })));
    const deps = createLiveReadinessDeps();
    const alerts = await deps.fetchCodeScanningAlerts({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(alerts).toEqual([]);
  });

  it('propagates a 403 (e.g. wrong token type for this endpoint) rather than silently reporting zero alerts', async () => {
    mockGraphQL(() => ({ repository: { pullRequest: GRAPHQL_FIELDS } }));
    server.use(http.get('https://api.github.com/repos/acme/widgets/code-scanning/alerts', () => HttpResponse.json({ message: 'Resource not accessible by integration' }, { status: 403 })));
    const deps = createLiveReadinessDeps();
    await expect(deps.fetchCodeScanningAlerts({ owner: 'acme', repo: 'widgets', pullNumber: 1 })).rejects.toThrow();
  });

  it('memoizes concurrent fetchers for the same ref into a single GraphQL round trip', async () => {
    let callCount = 0;
    mockGraphQL(() => {
      callCount += 1;
      return { repository: { pullRequest: GRAPHQL_FIELDS } };
    });
    const deps = createLiveReadinessDeps();
    const ref: PrReadinessRef = { owner: 'acme', repo: 'widgets', pullNumber: 1 };
    await Promise.all([deps.fetchChecks(ref), deps.fetchReviews(ref), deps.fetchReviewThreads(ref)]);
    expect(callCount).toBe(1);
  });
});

describe('checkPrReadiness', () => {
  it('wires the live deps and resolvePrLifecycleConfig into assessPrReadiness end to end', async () => {
    mockGraphQL(() => ({
      repository: {
        pullRequest: {
          headRefName: 'main',
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
          reviews: { nodes: [{ author: { login: 'x' }, state: 'APPROVED' }] },
          reviewThreads: { nodes: [] },
        },
      },
    }));
    mockRest('get', '/repos/acme/widgets/code-scanning/alerts', []);
    // No .config/gdlc/config.yml is present for this test's cwd, so
    // resolvePrLifecycleConfig({}) applies its documented default:
    // requireCleanCodeScanning: true -- the code-scanning fetch above is
    // expected to actually run, not be skipped.
    const result = await checkPrReadiness({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(result.settled).toBe(true);
    expect(result.codeScanningAlerts.total).toBe(0);
  });

  // Issue #281: same root cause as gdlc#274/#280 -- checkPrReadiness's
  // resolvePrLifecycleConfig(loadGdlcConfig()) call ignored startDir
  // entirely and always read process.cwd(), unrelated to whichever repo a
  // tool call concerns.
  describe('startDir resolution', () => {
    const originalCwd = process.cwd();
    const originalXdg = process.env.XDG_CONFIG_HOME;

    afterEach(() => {
      process.chdir(originalCwd);
      if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = originalXdg;
    });

    function tmpProjectWith(contents: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'pr-readiness-startdir-'));
      const gdlcDir = join(dir, '.config', 'gdlc');
      mkdirSync(gdlcDir, { recursive: true });
      writeFileSync(join(gdlcDir, 'config.yml'), contents);
      return dir;
    }

    it('resolves prLifecycle config from startDir, not process.cwd(), when startDir is given', async () => {
      const cwdRoot = mkdtempSync(join(tmpdir(), 'pr-readiness-cwd-')); // no config here
      const otherRoot = tmpProjectWith('prLifecycle:\n  requireCleanCodeScanning: false\n');
      process.chdir(cwdRoot);
      process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'pr-readiness-empty-global-'));

      mockGraphQL(() => ({
        repository: {
          pullRequest: {
            headRefName: 'main',
            commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
            reviews: { nodes: [{ author: { login: 'x' }, state: 'APPROVED' }] },
            reviewThreads: { nodes: [] },
          },
        },
      }));
      let codeScanningCalled = false;
      server.use(
        http.get('https://api.github.com/repos/acme/widgets/code-scanning/alerts', () => {
          codeScanningCalled = true;
          return HttpResponse.json([]);
        }),
      );

      const result = await checkPrReadiness({ owner: 'acme', repo: 'widgets', pullNumber: 1, startDir: otherRoot });

      // requireCleanCodeScanning: false in the startDir config means the
      // code-scanning fetch should never run at all -- if this test instead
      // read process.cwd() (no config there), the default true would apply
      // and codeScanningCalled would flip to true.
      expect(codeScanningCalled).toBe(false);
      expect(result.settled).toBe(true);
    });
  });
});
