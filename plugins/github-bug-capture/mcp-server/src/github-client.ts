import { execFileSync } from 'node:child_process';
import { BugCaptureError } from './errors.js';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;

let cachedToken: string | undefined;

export type ExecFileSyncFn = (command: string, args: string[], options: { encoding: 'utf8' }) => string;

const defaultExecFileSync: ExecFileSyncFn = (command, args, options) => execFileSync(command, args, options);

/** Same auth path as the sibling plugins: env var first, `gh auth token`
 * fallback. This scaffold's own tool surface (get_agent_capabilities) is
 * read-only, so no mutation-pacing governor is wired in yet -- but per
 * ADR-0001 this client IS the intended home for it: epic #28's triage-board
 * tools file and mutate issues, and must reuse the sibling plugins'
 * rate-limit classification and deterministic mutation-pacing discipline
 * here rather than re-deriving it. */
export function resolveToken(execImpl: ExecFileSyncFn = defaultExecFileSync): string {
  if (cachedToken) return cachedToken;
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    cachedToken = envToken;
    return envToken;
  }
  try {
    const token = execImpl('gh', ['auth', 'token'], { encoding: 'utf8' }).trim();
    if (token) {
      cachedToken = token;
      return token;
    }
  } catch {
    // fall through to the error below
  }
  throw new BugCaptureError('missing_scope', 'No GitHub token available. Set GITHUB_TOKEN, or run `gh auth login`.');
}

export function resetAuthCacheForTests(): void {
  cachedToken = undefined;
}

class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited, retry after ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** RFC 9110 permits Retry-After as either seconds or an HTTP-date. */
function parseRetryAfterSeconds(header: string): number {
  const trimmed = header.trim();
  if (trimmed === '') return DEFAULT_RETRY_AFTER_SECONDS;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/** GitHub's primary rate limit signals via X-RateLimit-Remaining: 0 +
 * X-RateLimit-Reset on a 403, typically without Retry-After. */
function secondsUntilRateLimitReset(resetHeader: string | null): number {
  if (!resetHeader) return DEFAULT_RETRY_AFTER_SECONDS;
  const resetEpochSeconds = Number(resetHeader);
  if (!Number.isFinite(resetEpochSeconds)) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.max(0, resetEpochSeconds - Math.floor(Date.now() / 1000));
}

async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
  attempt = 0,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(err.retryAfterSeconds * 1000);
      return withRateLimitBackoff(fn, sleep, attempt + 1);
    }
    throw err;
  }
}

/** 403 is ambiguous: secondary (abuse-detection) rate limit (Retry-After),
 * primary (request-budget) rate limit (X-RateLimit-Remaining: 0 +
 * X-RateLimit-Reset, typically no Retry-After), or a plain permission
 * denial (neither header). Both signals are checked before falling
 * through to a generic error, matching the sibling plugins' handling.
 *
 * A 202 is NOT an error here -- GitHub's stats endpoints (e.g.
 * /stats/contributors) return 202 with an empty body while the stats are
 * being computed asynchronously on a cache miss; the caller is expected
 * to retry shortly. Returned as `undefined` like a 204, and the calling
 * tool decides what that means for its own response shape. */
async function handleResponse(res: Response): Promise<unknown> {
  const retryAfter = res.headers.get('retry-after');
  const primaryLimitExhausted = res.headers.get('x-ratelimit-remaining') === '0';
  if (res.status === 429) {
    throw new RateLimitError(retryAfter ? parseRetryAfterSeconds(retryAfter) : DEFAULT_RETRY_AFTER_SECONDS);
  }
  if (res.status === 403 && retryAfter !== null) {
    throw new RateLimitError(parseRetryAfterSeconds(retryAfter));
  }
  if (res.status === 403 && primaryLimitExhausted) {
    throw new RateLimitError(secondsUntilRateLimitReset(res.headers.get('x-ratelimit-reset')));
  }
  if (!res.ok) {
    const text = await res.text();
    throw new BugCaptureError('github_api_error', `GitHub API error ${res.status}: ${text}`, { status: res.status });
  }
  if (res.status === 202 || res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

export interface GithubClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function githubGet(path: string, deps: GithubClientDeps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  return withRateLimitBackoff(
    async () => {
      const token = resolveToken();
      const res = await fetchImpl(`${GITHUB_API}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
        },
      });
      return handleResponse(res);
    },
    sleep,
  );
}
