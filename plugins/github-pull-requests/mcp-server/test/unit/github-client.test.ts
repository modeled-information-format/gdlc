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
});
