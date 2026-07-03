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
});
