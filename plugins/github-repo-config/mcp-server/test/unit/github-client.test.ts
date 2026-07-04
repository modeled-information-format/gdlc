import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../setup.js';
import { mockRest } from '../helpers.js';
import { githubRest, resolveToken, resetAuthCacheForTests } from '../../src/github-client.js';
import { RepoConfigError } from '../../src/errors.js';

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
    expect(() => resolveToken(execImpl)).toThrowError(RepoConfigError);
  });
});

describe('githubRest', () => {
  it('returns parsed JSON on success', async () => {
    mockRest('get', '/repos/acme/widgets/branches/main/protection', { enforce_admins: { enabled: true } });
    const data = await githubRest('/repos/acme/widgets/branches/main/protection');
    expect(data).toEqual({ enforce_admins: { enabled: true } });
  });

  it('wraps a non-2xx response in github_api_error', async () => {
    mockRest('get', '/repos/acme/widgets/branches/missing/protection', { message: 'Not Found' }, 404);
    await expect(githubRest('/repos/acme/widgets/branches/missing/protection')).rejects.toMatchObject({ code: 'github_api_error' });
  });

  it('retries after a 403 rate-limit response', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/rulesets', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json([]);
      }),
    );
    const data = await githubRest('/repos/acme/widgets/rulesets', {}, { sleep: () => Promise.resolve() });
    expect(data).toEqual([]);
    expect(calls).toBe(2);
  });

  it('treats a 403 without a retry-after header as a real error, not a rate limit', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme/forbidden', () => {
        calls += 1;
        return HttpResponse.json({ message: 'Resource not accessible by integration' }, { status: 403 });
      }),
    );
    await expect(githubRest('/orgs/acme/forbidden')).rejects.toMatchObject({
      code: 'github_api_error',
      message: expect.stringContaining('Resource not accessible by integration'),
    });
    expect(calls).toBe(1);
  });

  it('parses an HTTP-date retry-after header instead of producing NaN', async () => {
    let calls = 0;
    const futureDate = new Date(Date.now() + 5000).toUTCString();
    server.use(
      http.get('https://api.github.com/orgs/acme/date-limited', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': futureDate } });
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    await githubRest('/orgs/acme/date-limited', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(Number.isNaN(observedSleepMs)).toBe(false);
    expect(observedSleepMs).toBeGreaterThanOrEqual(0);
    expect(observedSleepMs).toBeLessThanOrEqual(6000);
  });

  it('falls back to the default backoff for a malformed retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/orgs/acme/garbage-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': 'not-a-real-value' } }),
      ),
    );
    await githubRest('/orgs/acme/garbage-header', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } }).catch(() => undefined);
    expect(observedSleepMs).toBe(60_000);
  });

  it('falls back to the default backoff for an empty/whitespace retry-after header', async () => {
    let observedSleepMs = -1;
    server.use(
      http.get('https://api.github.com/orgs/acme/empty-header', () =>
        HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '   ' } }),
      ),
    );
    await githubRest('/orgs/acme/empty-header', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } }).catch(() => undefined);
    expect(observedSleepMs).toBe(60_000);
  });

  it('backs off on a primary rate limit (403, X-RateLimit-Remaining: 0, no Retry-After) using X-RateLimit-Reset', async () => {
    let calls = 0;
    const resetEpochSeconds = Math.floor(Date.now() / 1000) + 5;
    server.use(
      http.get('https://api.github.com/orgs/acme/primary-limited', () => {
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
    const data = await githubRest('/orgs/acme/primary-limited', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(data).toEqual({ id: 1 });
    expect(calls).toBe(2);
    expect(observedSleepMs).toBeGreaterThanOrEqual(0);
    expect(observedSleepMs).toBeLessThanOrEqual(6000);
  });

  it('honors an explicit retry-after value on a 429 response', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/orgs/acme/429-limited', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429, headers: { 'retry-after': '3' } });
        return HttpResponse.json({ id: 1 });
      }),
    );
    let observedSleepMs = -1;
    await githubRest('/orgs/acme/429-limited', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(observedSleepMs).toBe(3000);
  });

  it('defaults to a 60s backoff when no retry-after header is present', async () => {
    let calls = 0;
    let observedSleepMs = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/pages', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 429 });
        return HttpResponse.json({ url: null, status: null, build_type: 'workflow', html_url: null });
      }),
    );
    await githubRest('/repos/acme/widgets/pages', {}, { sleep: (ms) => { observedSleepMs = ms; return Promise.resolve(); } });
    expect(observedSleepMs).toBe(60_000);
  });

  it('returns undefined for a 204 No Content response', async () => {
    server.use(http.delete('https://api.github.com/repos/acme/widgets/branches/main/protection', () => new HttpResponse(null, { status: 204 })));
    const data = await githubRest('/repos/acme/widgets/branches/main/protection', { method: 'DELETE' });
    expect(data).toBeUndefined();
  });

  it('paces a second mutating call within the minimum interval, but not the first', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it('does not pace GET calls even back-to-back with a mutating call', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    mockRest('get', '/orgs/acme/properties/schema', []);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep });
    await githubRest('/orgs/acme/properties/schema', {}, { sleep });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('paces a lowercase mutating method the same as its uppercase form', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/orgs/acme/properties/values', { method: 'patch' }, { sleep });
    expect(sleep).not.toHaveBeenCalled();
    await githubRest('/orgs/acme/properties/values', { method: 'patch' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent mutating calls so both get paced correctly, not both skipped', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await Promise.all([
      githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep }),
      githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep }),
    ]);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('paces a retried mutating attempt, not just the first attempt', async () => {
    let calls = 0;
    server.use(
      http.patch('https://api.github.com/orgs/acme/retried', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const sleep = vi.fn().mockResolvedValue(undefined);
    await githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep });
    sleep.mockClear();
    await githubRest('/orgs/acme/retried', { method: 'PATCH' }, { sleep });
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('uses the real default sleep implementation when no sleep override is given', async () => {
    let calls = 0;
    server.use(
      http.get('https://api.github.com/repos/acme/widgets/rulesets/9', () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({ message: 'limited' }, { status: 403, headers: { 'retry-after': '0' } });
        return HttpResponse.json({ id: 9, name: 'main', target: 'branch', enforcement: 'active' });
      }),
    );
    const data = await githubRest('/repos/acme/widgets/rulesets/9');
    expect(data).toEqual({ id: 9, name: 'main', target: 'branch', enforcement: 'active' });
  });

  it('keeps the mutation-pacing gate alive if a sleep call rejects', async () => {
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    const sleep = vi.fn().mockRejectedValueOnce(new Error('sleep failed')).mockResolvedValue(undefined);
    await githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep });
    await expect(githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep })).rejects.toThrow('sleep failed');
    mockRest('patch', '/orgs/acme/properties/values', {}, 204);
    await expect(githubRest('/orgs/acme/properties/values', { method: 'PATCH' }, { sleep })).resolves.toBeUndefined();
  });
});
