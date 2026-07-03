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
});
