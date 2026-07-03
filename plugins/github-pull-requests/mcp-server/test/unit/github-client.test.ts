import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest, mockGraphQL } from '../helpers.js';
import { githubRest, githubGraphQL, resolveToken, resetAuthCacheForTests } from '../../src/github-client.js';
import { PrError } from '../../src/errors.js';

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

  it('throws github_api_error when neither source yields a token', () => {
    delete process.env.GITHUB_TOKEN;
    resetAuthCacheForTests();
    const execImpl = vi.fn().mockImplementation(() => {
      throw new Error('gh: command not found');
    });
    expect(() => resolveToken(execImpl)).toThrowError(PrError);
  });
});

describe('githubRest', () => {
  it('returns parsed JSON on success', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/1', { number: 1, state: 'open' });
    const data = await githubRest('/repos/acme/widgets/pulls/1');
    expect(data).toEqual({ number: 1, state: 'open' });
  });

  it('wraps a non-2xx response in github_api_error', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/999', { message: 'Not Found' }, 404);
    await expect(githubRest('/repos/acme/widgets/pulls/999')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('retries after a 403 rate-limit response', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/pulls/2', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ number: 2 });
      }),
    );
    const data = await githubRest('/repos/acme/widgets/pulls/2', {}, { sleep: () => Promise.resolve() });
    expect(data).toEqual({ number: 2 });
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
      http.get('https://api.github.com/repos/acme/garbage-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': 'not-a-real-value' } }),
      ),
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
      http.get('https://api.github.com/repos/acme/empty-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '   ' } }),
      ),
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

  it('defaults to a 60s backoff when no retry-after header is present', async () => {
    let calls = 0;
    let observedSleepMs = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/pulls/8', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429 });
        return HttpResponse.json({ number: 8 });
      }),
    );
    await githubRest(
      '/repos/acme/widgets/pulls/8',
      {},
      {
        sleep: (ms) => {
          observedSleepMs = ms;
          return Promise.resolve();
        },
      },
    );
    expect(observedSleepMs).toBe(60_000);
  });

  it('returns undefined for a 204 No Content response', async () => {
    server.use(http.get('https://api.github.com/repos/acme/widgets/pulls/9', () => new HttpResponse(null, { status: 204 })));
    const data = await githubRest('/repos/acme/widgets/pulls/9');
    expect(data).toBeUndefined();
  });

  it('paces a second mutating call within the minimum interval, but not the first', async () => {
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not pace GET calls even back-to-back with a mutating call', async () => {
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    mockRest('get', '/repos/acme/widgets/pulls/1', { number: 1 });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep });
    await githubRest('/repos/acme/widgets/pulls/1', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('paces a lowercase mutating method the same as its uppercase form', async () => {
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'post' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'post' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent mutating calls so both get paced correctly, not both skipped', async () => {
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep }),
      githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep }),
    ]);
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
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep });
    sleep.mockClear();
    await githubRest('/repos/acme/retried', { method: 'POST' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('uses the real default sleep implementation when no sleep override is given', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/pulls/10', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ number: 10 });
      }),
    );
    const data = await githubRest('/repos/acme/widgets/pulls/10');
    expect(data).toEqual({ number: 10 });
  });

  it('keeps the mutation-pacing gate alive if a sleep call rejects', async () => {
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    const sleep = vi.fn().mockRejectedValueOnce(new Error('sleep failed')).mockResolvedValue(undefined);
    await githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep });
    // Second call is within the pacing window, so it must sleep -- that
    // sleep rejects, but the gate's .catch() must keep the chain usable.
    await expect(githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep })).rejects.toThrow(
      'sleep failed',
    );
    // A third call proves the gate wasn't left permanently broken.
    mockRest('post', '/repos/acme/widgets/pulls/1/requested_reviewers', { users: [] });
    await expect(
      githubRest('/repos/acme/widgets/pulls/1/requested_reviewers', { method: 'POST' }, { sleep }),
    ).resolves.toBeDefined();
  });
});

describe('githubGraphQL', () => {
  it('returns the data payload on success', async () => {
    mockGraphQL(() => ({ viewer: { login: 'octocat' } }));
    const data = await githubGraphQL<{ viewer: { login: string } }>('query { viewer { login } }');
    expect(data.viewer.login).toBe('octocat');
  });

  it('throws github_api_error with the GraphQL error list on failure', async () => {
    mockGraphQL(() => ({ __errors: [{ message: 'nope' }] }));
    await expect(githubGraphQL('query { x }')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('throws github_api_error when the response has neither data nor errors', async () => {
    server.use(http.post('https://api.github.com/graphql', () => HttpResponse.json({})));
    await expect(githubGraphQL('query { x }')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('paces a second mutation within the minimum interval, but not the first', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('mutation { createThing }', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubGraphQL('mutation { createThing }', {}, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not pace a query, even immediately after a mutation', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('mutation { createThing }', {}, { sleep });
    await githubGraphQL('query { thing }', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('paces a mutation preceded by a leading GraphQL comment', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubGraphQL('# a comment\nmutation { createThing }', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubGraphQL('# another comment\nmutation { createThing }', {}, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent mutations so both get paced correctly, not both skipped', async () => {
    mockGraphQL(() => ({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      githubGraphQL('mutation { createThing }', {}, { sleep }),
      githubGraphQL('mutation { createThing }', {}, { sleep }),
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
