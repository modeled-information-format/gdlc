import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest, mockGraphQL, mockUserScopes } from '../helpers.js';
import { assertProjectScope, githubGet, githubGraphQL, resolveToken, resetAuthCacheForTests } from '../../src/github-client.js';
import { BugCaptureError } from '../../src/errors.js';

describe('resolveToken', () => {
  it('prefers GITHUB_TOKEN when set', () => {
    process.env.GITHUB_TOKEN = 'env-token';
    expect(resolveToken()).toBe('env-token');
  });

  it('falls back to `gh auth token`', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockReturnValue('gh-cli-token\n');
    expect(resolveToken(execImpl)).toBe('gh-cli-token');
  });

  it('throws missing_scope when neither source yields a token', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockImplementation(() => {
      throw new Error('gh: command not found');
    });
    let thrown: unknown;
    try {
      resolveToken(execImpl);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(BugCaptureError);
    expect((thrown as BugCaptureError).code).toBe('missing_scope');
  });
});

describe('githubGet', () => {
  it('returns parsed JSON on success', async () => {
    mockRest('get', '/repos/acme/widgets/traffic/views', { count: 10, uniques: 5, views: [] });
    const data = await githubGet('/repos/acme/widgets/traffic/views');
    expect(data).toEqual({ count: 10, uniques: 5, views: [] });
  });

  it('wraps a non-2xx response in github_api_error', async () => {
    mockRest('get', '/repos/acme/widgets/traffic/clones', { message: 'Not Found' }, 404);
    await expect(githubGet('/repos/acme/widgets/traffic/clones')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('returns undefined for a 202 Accepted (stats being computed)', async () => {
    server.use(http.get('https://api.github.com/repos/acme/widgets/stats/contributors', () => new HttpResponse(null, { status: 202 })));
    const data = await githubGet('/repos/acme/widgets/stats/contributors');
    expect(data).toBeUndefined();
  });

  it('returns undefined for a 204 No Content response', async () => {
    server.use(http.get('https://api.github.com/repos/acme/widgets/empty', () => new HttpResponse(null, { status: 204 })));
    const data = await githubGet('/repos/acme/widgets/empty');
    expect(data).toBeUndefined();
  });

  it('retries after a 403 rate-limit response', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/community/profile', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ health_percentage: 100 });
      }),
    );
    const data = await githubGet('/repos/acme/widgets/community/profile', { sleep: () => Promise.resolve() });
    expect(data).toEqual({ health_percentage: 100 });
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
    await expect(githubGet('/repos/acme/forbidden')).rejects.toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('Resource not accessible by integration'),
    });
    expect(calls).toBe(1);
  });

  it('parses an HTTP-date retry-after header instead of producing NaN', async () => {
    let calls = 0;
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    server.use(
      http.get('https://api.github.com/repos/acme/date-limited', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': futureDate } });
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    await githubGet('/repos/acme/date-limited', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(Number.isNaN(observedSleepMs)).toBe(false);
    expect(observedSleepMs).toBeGreaterThanOrEqual(0);
    expect(observedSleepMs).toBeLessThanOrEqual(6000);
  });

  it('falls back to the default backoff for a malformed retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/repos/acme/garbage-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': 'not-a-real-value' } }),
      ),
    );
    await githubGet('/repos/acme/garbage-header', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } }).catch(() => undefined);
    expect(observedSleepMs).toBe(60_000);
  });

  it('falls back to the default backoff for an empty/whitespace retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/repos/acme/empty-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '   ' } }),
      ),
    );
    await githubGet('/repos/acme/empty-header', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } }).catch(() => undefined);
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
    const data = await githubGet('/repos/acme/primary-limited', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(data).toEqual({ id: 1 });
    expect(calls).toBe(2);
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
    await githubGet('/repos/acme/429-limited', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(observedSleepMs).toBe(3000);
  });

  it('defaults to a 60s backoff when no retry-after header is present', async () => {
    let calls = 0;
    let observedSleepMs = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/dependency-graph/sbom', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429 });
        return HttpResponse.json({ sbom: { spdxVersion: 'SPDX-2.3', packages: [] } });
      }),
    );
    await githubGet('/repos/acme/widgets/dependency-graph/sbom', { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(observedSleepMs).toBe(60_000);
  });

  it('uses the real default sleep implementation when no sleep override is given', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/stats/contributors', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json([]);
      }),
    );
    const data = await githubGet('/repos/acme/widgets/stats/contributors');
    expect(data).toEqual([]);
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
    // No /user mock registered -- if the check ran, this would throw an
    // unhandled-request error from msw, proving the /user call is skipped.
    await expect(assertProjectScope()).resolves.toBeUndefined();
  });

  it('skips the OAuth-scope check for a fine-grained PAT (github_pat_)', async () => {
    process.env.GITHUB_TOKEN = 'github_pat_11ABCDEFG_1234567890';
    resetAuthCacheForTests();
    await expect(assertProjectScope()).resolves.toBeUndefined();
  });
});

describe('githubGraphQL', () => {
  it('returns the data payload of a successful response', async () => {
    mockGraphQL((body) => {
      expect(body.variables).toEqual({ login: 'acme' });
      return { organization: { id: 'O_1' } };
    });
    const data = await githubGraphQL('query($login: String!) { organization(login: $login) { id } }', { login: 'acme' });
    expect(data).toEqual({ organization: { id: 'O_1' } });
  });

  it('wraps a GraphQL error array in github_api_error with the messages preserved', async () => {
    mockGraphQL(() => ({ __errors: [{ message: 'Field not found' }, { message: 'Something else' }] }));
    await expect(githubGraphQL('query { viewer { login } }')).rejects.toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('Field not found'),
    });
  });

  it('rejects a response with neither data nor errors', async () => {
    server.use(http.post('https://api.github.com/graphql', () => HttpResponse.json({})));
    await expect(githubGraphQL('query { viewer { login } }')).rejects.toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('no data and no errors'),
    });
  });

  it('retries after a rate-limit response like the REST path does', async () => {
    let calls = 0;
    server.use(
      http.post('https://api.github.com/graphql', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ data: { viewer: { login: 'octocat' } } });
      }),
    );
    const data = await githubGraphQL('query { viewer { login } }', {}, { sleep: () => Promise.resolve() });
    expect(data).toEqual({ viewer: { login: 'octocat' } });
    expect(calls).toBe(2);
  });

  it('paces back-to-back mutations at least MIN_MUTATION_INTERVAL_MS apart', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await githubGraphQL('mutation { a }', {}, { sleep });
    await githubGraphQL('mutation { b }', {}, { sleep });
    // First mutation runs immediately (fresh pacing state); the second must
    // wait out the remainder of the 1000ms window.
    expect(sleeps.length).toBe(1);
    expect(sleeps[0]).toBeGreaterThan(0);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);
  });

  it('does not pace queries', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await githubGraphQL('mutation { a }', {}, { sleep });
    await githubGraphQL('query { b }', {}, { sleep });
    await githubGraphQL('query { c }', {}, { sleep });
    expect(sleeps).toEqual([]);
  });

  it('detects a mutation behind leading GraphQL comment lines', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await githubGraphQL('mutation { a }', {}, { sleep });
    await githubGraphQL('# create the field\nmutation { b }', {}, { sleep });
    expect(sleeps.length).toBe(1);
  });

  it('serializes concurrent mutations so the pacing window cannot be raced', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleeps: number[] = [];
    const sleep = (ms: number): Promise<void> => {
      sleeps.push(ms);
      return Promise.resolve();
    };
    await Promise.all([
      githubGraphQL('mutation { a }', {}, { sleep }),
      githubGraphQL('mutation { b }', {}, { sleep }),
    ]);
    expect(sleeps.length).toBe(1);
  });

  it('uses the real default sleep implementation when no sleep override is given', async () => {
    mockGraphQL(() => ({ ok: true }));
    const data = await githubGraphQL('query { viewer { login } }');
    expect(data).toEqual({ ok: true });
  });
});
