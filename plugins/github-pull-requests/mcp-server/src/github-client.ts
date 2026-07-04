import { execFileSync } from 'node:child_process';
import { PrError } from './errors.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;

let cachedToken: string | undefined;
let projectScopeChecked = false;

export type ExecFileSyncFn = (command: string, args: string[], options: { encoding: 'utf8' }) => string;

const defaultExecFileSync: ExecFileSyncFn = (command, args, options) => execFileSync(command, args, options);

/** Same auth path as github-sdlc-planning (feature spec: "no additional
 * scope beyond what project-planning already requires, so a shared
 * token/session serves both plugins"). */
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
  throw new PrError('github_api_error', 'No GitHub token available. Set GITHUB_TOKEN, or run `gh auth login`.');
}

/** Deterministic governor, not incidental pacing from how fast a given agent
 * happens to call tools: GitHub's secondary (abuse-detection) rate limit for
 * content-creating mutations is undocumented in /rate_limit and triggers on
 * burst *pattern*, not primary-budget exhaustion (confirmed live against
 * gdlc-sandbox: a 5-run/40-minute burst of create-branch+commit+PR tripped
 * it with the primary REST budget still ~99% unused). A reactive
 * catch-403-and-retry loop alone isn't sufficient for tools whose real jobs
 * (request_review across several PRs, cross-referencing linked issues)
 * intentionally issue multiple writes in sequence. MIN_MUTATION_INTERVAL_MS
 * caps mutating calls at 60/minute, comfortably under GitHub's informally
 * documented ~80/minute secondary-limit guidance, enforced here
 * unconditionally regardless of which MCP host or model is driving the
 * calls. */
const MIN_MUTATION_INTERVAL_MS = 1000;
let lastMutationAt = 0;
/** Serializes concurrent enforceMutationPacing() calls: each invocation
 * chains onto the previous one's completion, so the check-then-update of
 * lastMutationAt can never race even if callers fire mutations via
 * Promise.all (Copilot review finding: an unserialized shared timestamp lets
 * two concurrent mutations both observe the same "enough time has passed"
 * state and proceed without sleeping). */
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

/** GraphQL comments are full lines starting with `#` (spec-defined, not a
 * heuristic) -- strip them before checking for the mutation keyword so a
 * mutation preceded by a leading comment is still detected (Copilot review
 * finding). */
function isGraphQLMutation(query: string): boolean {
  const withoutComments = query
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  return withoutComments.trim().startsWith('mutation');
}

export function resetAuthCacheForTests(): void {
  cachedToken = undefined;
  projectScopeChecked = false;
  lastMutationAt = 0;
  mutationGate = Promise.resolve();
}

function tokenHasOAuthScopeModel(token: string): boolean {
  return token.startsWith('ghp_') || token.startsWith('gho_');
}

/** Checked once per process, duplicated from github-sdlc-planning's own
 * assertProjectScope rather than imported (it's tightly coupled to that
 * package's private token-cache state, and isn't exported via its
 * package.json). Only meaningful for classic OAuth-scoped tokens; App
 * installation tokens and fine-grained PATs skip this check and rely on the
 * actual GraphQL call to surface a real permission error if the token
 * genuinely lacks access. */
export async function assertProjectScope(fetchImpl: typeof fetch = fetch): Promise<void> {
  if (projectScopeChecked) return;
  const token = resolveToken();
  if (!tokenHasOAuthScopeModel(token)) {
    projectScopeChecked = true;
    return;
  }
  const res = await fetchImpl(`${GITHUB_API}/user`, {
    headers: { Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': API_VERSION },
  });
  // A non-2xx here (expired token, transient outage) must not be
  // misdiagnosed as "missing project scope" -- an empty scopes header from
  // a failed request looks identical to a genuinely under-scoped token.
  if (!res.ok) {
    const text = await res.text();
    throw new PrError('github_api_error', `Failed to verify token scopes: GET /user returned ${res.status}: ${text}`, {
      status: res.status,
    });
  }
  const scopesHeader = res.headers.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.includes('project')) {
    throw new PrError(
      'missing_scope',
      'GitHub token is missing the `project` scope required for Projects v2 writes. Run `gh auth login --scopes project`.',
      { missingScope: 'project', presentScopes: scopes },
    );
  }
  projectScopeChecked = true;
}

class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limited, retry after ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 60;

/** RFC 9110 permits Retry-After as either a number of seconds or an
 * HTTP-date; Number() on a date string produces NaN, which would make
 * sleep(NaN) resolve near-instantly (Copilot review finding) instead of
 * backing off -- exactly wrong during a real rate limit. Parses both forms,
 * falling back to a sane default for anything else. */
function parseRetryAfterSeconds(header: string): number {
  const trimmed = header.trim();
  if (trimmed === '') return DEFAULT_RETRY_AFTER_SECONDS;
  const asSeconds = Number(trimmed);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) return asSeconds;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    // Ceil, not round: rounding down (e.g. 0.4s remaining -> 0) would retry
    // before the server-specified time. Always wait at least until then.
    return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/** GitHub's primary rate limit (request-count budget) signals via
 * X-RateLimit-Remaining: 0 + X-RateLimit-Reset (a Unix-epoch-seconds
 * timestamp) on a 403, typically *without* Retry-After -- Retry-After is
 * specific to secondary (abuse-detection) limits. Requiring Retry-After
 * alone (an earlier version of this fix) would have misclassified a real
 * primary-limit exhaustion as a permission error and stopped backing off on
 * it (Copilot review finding). */
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

/** 429 ("Too Many Requests") is unambiguously rate-limiting. 403
 * ("Forbidden") is ambiguous -- GitHub returns it for three different
 * things: secondary (abuse-detection) rate limits, which set Retry-After;
 * primary (request-budget) rate limits, which set X-RateLimit-Remaining: 0
 * and X-RateLimit-Reset but typically *not* Retry-After; and ordinary
 * permission-denied errors, which set neither. Treating every 403 as
 * rate-limited (the original bug) discarded the real response body and
 * wasted up to 3 retries (180s+) surfacing a misleading "Rate limited"
 * message for errors that were never about rate limiting at all. Checking
 * only Retry-After (an earlier version of this fix) would have
 * misclassified real primary-limit exhaustion as a permission error instead
 * -- both signals must be checked. */
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
    throw new PrError('github_api_error', `GitHub API error ${res.status}: ${text}`, { status: res.status });
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
      // Paced on every attempt (including retries after a rate-limit wait),
      // not just the first -- a retry-after of 0 or a few seconds could
      // otherwise let back-to-back retries bypass the governor entirely.
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

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

export async function githubGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
  deps: GithubClientDeps = {},
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const isMutating = isGraphQLMutation(query);
  return withRateLimitBackoff(
    async () => {
      if (isMutating) {
        await enforceMutationPacing(sleep);
      }
      const token = resolveToken();
      const res = await fetchImpl(GITHUB_GRAPHQL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      const json = (await handleResponse(res)) as GraphQLResponse<T>;
      if (json.errors?.length) {
        throw new PrError('github_api_error', `GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`, {
          graphqlErrors: json.errors,
        });
      }
      if (json.data === undefined) {
        throw new PrError('github_api_error', 'GitHub GraphQL response had no data and no errors');
      }
      return json.data;
    },
    sleep,
  );
}
