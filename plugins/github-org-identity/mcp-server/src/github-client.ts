import { execFileSync } from 'node:child_process';
import { OrgIdentityError } from './errors.js';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;

let cachedToken: string | undefined;

export type ExecFileSyncFn = (command: string, args: string[], options: { encoding: 'utf8' }) => string;

const defaultExecFileSync: ExecFileSyncFn = (command, args, options) => execFileSync(command, args, options);

/** Same auth path as the sibling plugins: env var first, `gh auth token`
 * fallback. Organization-roles endpoints additionally require the
 * resolved identity to hold org-level admin:org (classic PAT) or the
 * App-installation members/organization_administration permission — this
 * client does not pre-check that permission scope (unlike the sibling
 * plugins' Projects v2 assertProjectScope): a missing-permission response
 * from the real endpoint surfaces as a plain github_api_error. (A separate
 * pre-check does exist one layer up, in roles.ts's
 * assertOrganizationRolesSupported -- that one probes the org's *plan
 * tier*, a different axis from the identity's *permission scope* checked
 * here, and reports a typed feature_unavailable rather than gating on it.) */
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
  throw new OrgIdentityError('missing_scope', 'No GitHub token available. Set GITHUB_TOKEN, or run `gh auth login --scopes admin:org`.');
}

/** Deterministic governor, not incidental pacing: caps mutating REST calls
 * at 60/minute, matching the sibling plugins' MIN_MUTATION_INTERVAL_MS
 * reasoning (GitHub's undocumented secondary abuse-rate limit). */
const MIN_MUTATION_INTERVAL_MS = 1000;
let lastMutationAt = 0;
let mutationGate: Promise<void> = Promise.resolve();

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function enforceMutationPacing(sleep: (ms: number) => Promise<void>): Promise<void> {
  const turn = mutationGate.then(async () => {
    const elapsed = Date.now() - lastMutationAt;
    if (elapsed < MIN_MUTATION_INTERVAL_MS) {
      await sleep(MIN_MUTATION_INTERVAL_MS - elapsed);
    }
    lastMutationAt = Date.now();
  });
  mutationGate = turn.catch(() => undefined);
  return turn;
}

export function resetAuthCacheForTests(): void {
  cachedToken = undefined;
  lastMutationAt = 0;
  mutationGate = Promise.resolve();
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
 * through to a generic error, matching the sibling plugins' handling. */
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
    throw new OrgIdentityError('github_api_error', `GitHub API error ${res.status}: ${text}`, { status: res.status });
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

interface RestOptions {
  method?: string;
  body?: unknown;
}

export interface GithubClientDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function githubRest(path: string, opts: RestOptions = {}, deps: GithubClientDeps = {}): Promise<unknown> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const method = (opts.method ?? 'GET').toUpperCase();
  const isMutating = MUTATING_METHODS.has(method);
  return withRateLimitBackoff(
    async () => {
      if (isMutating) {
        await enforceMutationPacing(sleep);
      }
      const token = resolveToken();
      const res = await fetchImpl(`${GITHUB_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': API_VERSION,
          ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return handleResponse(res);
    },
    sleep,
  );
}
