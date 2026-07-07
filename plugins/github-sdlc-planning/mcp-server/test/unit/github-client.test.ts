import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest, mockGraphQL, mockUserScopes } from '../helpers.js';
import { githubRest, githubGraphQL, assertProjectScope, resolveToken, resetAuthCacheForTests } from '../../src/github-client.js';
import { PlanningError } from '../../src/errors.js';

describe('resolveToken', () => {
  it('prefers GITHUB_TOKEN when set', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    expect(resolveToken()).toBe('env-token');
  });

  it('falls back to `gh auth token` when GITHUB_TOKEN is unset', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockReturnValue('gh-cli-token\n');
    expect(resolveToken(execImpl)).toBe('gh-cli-token');
    expect(execImpl).toHaveBeenCalledWith('gh', ['auth', 'token'], { encoding: 'utf8' });
  });

  it('throws missing_scope with a remediation message when neither source yields a token', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockImplementation(() => {
      throw new Error('gh: command not found');
    });
    expect(() => resolveToken(execImpl)).toThrowError(PlanningError);
    resetAuthCacheForTests();
    try {
      resolveToken(execImpl);
      expect.unreachable('resolveToken should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PlanningError);
      expect((err as PlanningError).code).toBe('missing_scope');
    }
  });

  it('issue #105: picks up a changed credential mid-process without resetAuthCacheForTests, e.g. `gh auth switch`', () => {
    process.env.GITHUB_TOKEN = 'token-a';
    expect(resolveToken()).toBe('token-a');

    // No resetAuthCacheForTests() call here -- this is the exact scenario the
    // bug report reproduced: an account switch mid-session, still resolved
    // from the same live process, no restart. A stale module-level cache
    // would still return 'token-a' here; resolveToken must not.
    process.env.GITHUB_TOKEN = 'token-b';
    expect(resolveToken()).toBe('token-b');
  });

  it('issue #105: also re-resolves the `gh auth token` fallback path on every call, not just the GITHUB_TOKEN env path', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockReturnValueOnce('gh-token-account-a\n').mockReturnValueOnce('gh-token-account-b\n');
    expect(resolveToken(execImpl)).toBe('gh-token-account-a');
    expect(resolveToken(execImpl)).toBe('gh-token-account-b');
    expect(execImpl).toHaveBeenCalledTimes(2);
  });
});

describe('assertProjectScope', () => {
  it('resolves when the token has the project scope', async () => {
    mockUserScopes(['repo', 'project', 'read:org']);
    await expect(assertProjectScope()).resolves.toBeUndefined();
  });

  it('throws a named missing_scope error when project scope is absent', async () => {
    mockUserScopes(['repo', 'read:org']);
    await expect(assertProjectScope()).rejects.toMatchObject({
      code: 'missing_scope',
      details: { missingScope: 'project', presentScopes: ['repo', 'read:org'] },
    });
  });

  it('skips the OAuth-scope check for a GitHub App installation token (ghs_)', async () => {
    process.env.GITHUB_TOKEN = 'ghs_installation-token-1234567890';
    resetAuthCacheForTests();
    // No /user mock registered — if the check ran, this would throw an
    // unhandled-request error from msw, proving the /user call is skipped.
    await expect(assertProjectScope()).resolves.toBeUndefined();
  });

  it('skips the OAuth-scope check for a fine-grained PAT (github_pat_)', async () => {
    process.env.GITHUB_TOKEN = 'github_pat_11ABCDEFG_1234567890';
    resetAuthCacheForTests();
    await expect(assertProjectScope()).resolves.toBeUndefined();
  });
});

describe('githubRest', () => {
  it('returns parsed JSON on success', async () => {
    mockRest('get', '/repos/acme/widgets', { id: 1, name: 'widgets' });
    const data = await githubRest('/repos/acme/widgets');
    expect(data).toEqual({ id: 1, name: 'widgets' });
  });

  it('wraps a non-2xx response in a github_api_error PlanningError', async () => {
    mockRest('get', '/repos/acme/missing', { message: 'Not Found' }, 404);
    await expect(githubRest('/repos/acme/missing')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('retries after a 403 rate-limit response and succeeds on the next attempt', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/limited', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'rate limited' }, { status: 403, headers: { 'retry-after': '0' } });
        }
        return HttpResponse.json({ id: 42 });
      }),
    );
    const data = await githubRest('/repos/acme/limited', {}, { sleep: () => Promise.resolve() });
    expect(data).toEqual({ id: 42 });
    expect(calls).toBe(2);
  });

  it('treats a 403 without a retry-after header as a real error, not a rate limit', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/forbidden', () => {
        calls += 1;
        return HttpResponse.json({ message: 'Resource not accessible by integration' }, { status: 403 });
      }),
    );
    await expect(githubRest('/repos/acme/forbidden')).rejects.toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('Resource not accessible by integration'),
    });
    // No retry attempted -- a real 403 fails fast instead of wasting 180s.
    expect(calls).toBe(1);
  });

  it('parses an HTTP-date retry-after header instead of producing NaN', async () => {
    let calls = 0;
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    server.use(
      http.get('https://api.github.com/repos/acme/date-limited', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': futureDate } });
        }
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    await githubRest(
      '/repos/acme/date-limited',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    );
    expect(Number.isNaN(observedSleepMs)).toBe(false);
    // >= 0, not > 0: on a slow runner the 5s window could already have
    // elapsed, in which case clamping to 0 is correct, not a bug.
    expect(observedSleepMs).toBeGreaterThanOrEqual(0);
    expect(observedSleepMs).toBeLessThanOrEqual(6000);
  });

  it('falls back to the default backoff for a malformed retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/repos/acme/garbage-header', () => {
        return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': 'not-a-real-value' } });
      }),
    );
    await githubRest(
      '/repos/acme/garbage-header',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    ).catch(() => undefined);
    expect(observedSleepMs).toBe(60_000);
  });

  it('falls back to the default backoff for an empty/whitespace retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/repos/acme/empty-header', () => {
        return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '   ' } });
      }),
    );
    await githubRest(
      '/repos/acme/empty-header',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    ).catch(() => undefined);
    // Number('') === 0 in JS -- without trimming/checking for empty, this
    // would wrongly resolve to an immediate retry instead of the default.
    expect(observedSleepMs).toBe(60_000);
  });

  it('backs off on a primary rate limit (403, X-RateLimit-Remaining: 0, no Retry-After) using X-RateLimit-Reset', async () => {
    let calls = 0;
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 5;
    server.use(
      http.get('https://api.github.com/repos/acme/primary-limited', () => {
        calls += 1;
        if (calls === 1) {
          return HttpResponse.json(
            { message: 'API rate limit exceeded' },
            { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetEpochSeconds) } },
          );
        }
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    const data = await githubRest(
      '/repos/acme/primary-limited',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    );
    expect(data).toEqual({ id: 1 });
    expect(calls).toBe(2);
    // >= 0, not > 0: on a slow runner the 5s reset window could already
    // have elapsed, in which case clamping to 0 is correct, not a bug.
    expect(observedSleepMs).toBeGreaterThanOrEqual(0);
    expect(observedSleepMs).toBeLessThanOrEqual(6000);
  });

  it('honors an explicit retry-after value on a 429 response', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/429-limited', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429, headers: { 'retry-after': '3' } });
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    await githubRest(
      '/repos/acme/429-limited',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    );
    expect(observedSleepMs).toBe(3000);
  });

  it('paces a second mutating call within the minimum interval, but not the first', async () => {
    mockRest('post', '/repos/acme/widgets', { id: 1 });
    mockRest('post', '/repos/acme/widgets', { id: 2 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not pace GET calls even back-to-back with a mutating call', async () => {
    mockRest('post', '/repos/acme/widgets', { id: 1 });
    mockRest('get', '/repos/acme/widgets', { id: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep });
    await githubRest('/repos/acme/widgets', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('paces a lowercase mutating method the same as its uppercase form', async () => {
    mockRest('post', '/repos/acme/widgets', { id: 1 });
    mockRest('post', '/repos/acme/widgets', { id: 2 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets', { method: 'post' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/repos/acme/widgets', { method: 'post' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent mutating calls so both get paced correctly, not both skipped', async () => {
    mockRest('post', '/repos/acme/widgets', { id: 1 });
    mockRest('post', '/repos/acme/widgets', { id: 2 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep }),
      githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep }),
    ]);
    // Exactly one of the two concurrent calls had to wait for the other --
    // if the shared timestamp raced, both could see "no wait needed".
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('paces a retried mutating attempt, not just the first attempt', async () => {
    let calls = 0;
    server.use(
      http.post('https://api.github.com/repos/acme/retried', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ id: 1 });
      }),
    );
    // Prime lastMutationAt so the retried attempt (running "immediately"
    // after a 0s backoff sleep) is within the pacing window and must sleep.
    mockRest('post', '/repos/acme/widgets', { id: 0 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets', { method: 'POST' }, { sleep });
    sleep.mockClear();
    await githubRest('/repos/acme/retried', { method: 'POST' }, { sleep });
    // sleep is called once for the initial attempt's pacing, once for the
    // 403's retry-after wait, and once more for the retried attempt's own
    // pacing check -- proving pacing runs per-attempt, not only up front.
    expect(sleep).toHaveBeenCalledTimes(3);
  });
});

describe('githubGraphQL', () => {
  it('returns the data payload on success', async () => {
    mockGraphQL(() => ({ viewer: { login: 'octocat' } }));
    const data = await githubGraphQL<{ viewer: { login: string } }>('query { viewer { login } }');
    expect(data.viewer.login).toBe('octocat');
  });

  it('throws github_api_error with the GraphQL error list on failure', async () => {
    mockGraphQL(() => ({ __errors: [{ message: 'Something is not right' }] }));
    await expect(githubGraphQL('query { x }')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('throws github_api_error when the response has neither data nor errors', async () => {
    server.use(http.post('https://api.github.com/graphql', () => HttpResponse.json({})));
    await expect(githubGraphQL('query { x }')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('retries once without the preview header on a feature-retirement schema error', async () => {
    const seenPreviewHeaders: Array<string | null> = [];
    server.use(
      http.post('https://api.github.com/graphql', async ({ request }) => {
        seenPreviewHeaders.push(request.headers.get('GraphQL-Features'));
        if (seenPreviewHeaders.length === 1) {
          return HttpResponse.json({ errors: [{ message: 'Unknown argument "GraphQL-Features" preview retired' }] });
        }
        return HttpResponse.json({ data: { ok: true } });
      }),
    );
    const data = await githubGraphQL('query { x }', {}, { previewHeader: 'sub_issues' });
    expect(data).toEqual({ ok: true });
    expect(seenPreviewHeaders).toEqual(['sub_issues', null]);
  });

  it('paces a second mutation within the minimum interval, but not the first', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('mutation { createThing }', {}, {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubGraphQL('mutation { createThing }', {}, {}, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not pace a query, even immediately after a mutation', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('mutation { createThing }', {}, {}, { sleep });
    await githubGraphQL('query { thing }', {}, {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('paces a mutation preceded by a leading GraphQL comment', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('# a comment\nmutation { createThing }', {}, {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubGraphQL('# another comment\nmutation { createThing }', {}, {}, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent mutations so both get paced correctly, not both skipped', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      githubGraphQL('mutation { createThing }', {}, {}, { sleep }),
      githubGraphQL('mutation { createThing }', {}, {}, { sleep }),
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
