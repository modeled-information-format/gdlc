import { execFileSync } from 'node:child_process';
import { BugCaptureError } from './errors.js';

const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;

let cachedToken: string | undefined;
let projectScopeChecked = false;

export type ExecFileSyncFn = (command: string, args: string[], options: { encoding: 'utf8' }) => string;

const defaultExecFileSync: ExecFileSyncFn = (command, args, options) => execFileSync(command, args, options);

/** Same auth path as the sibling plugins: env var first, `gh auth token`
 * fallback. The mutation-pacing governor and rate-limit classification
 * below are what ADR-0001 anticipated this client would grow into: the
 * triage-board tools (epic #28) are the first write path through it,
 * reusing the sibling plugins' discipline rather than re-deriving it. */
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

/** Deterministic governor, not incidental pacing from how fast a given agent
 * happens to call tools: GitHub's secondary (abuse-detection) rate limit for
 * content-creating mutations is undocumented in /rate_limit and triggers on
 * burst *pattern*, not primary-budget exhaustion. A reactive
 * catch-403-and-retry loop alone isn't sufficient for tools that mutate in
 * sequence (severity sweeps across a triage board). MIN_MUTATION_INTERVAL_MS
 * caps mutating calls at 60/minute, comfortably under GitHub's informally
 * documented ~80/minute secondary-limit guidance, enforced unconditionally
 * regardless of which MCP host or model is driving the calls -- the same
 * discipline as the sibling plugins' github-client.ts. */
const MIN_MUTATION_INTERVAL_MS = 1000;
let lastMutationAt = 0;
/** Serializes concurrent enforceMutationPacing() calls: each invocation
 * chains onto the previous one's completion, so the check-then-update of
 * lastMutationAt can never race even if callers fire mutations via
 * Promise.all. */
let mutationGate: Promise<void> = Promise.resolve();

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
 * mutation preceded by a leading comment is still detected. */
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

/** Classic PATs (`ghp_`) and OAuth App user tokens (`gho_`) carry the
 * `X-OAuth-Scopes` response header the check below reads. GitHub App
 * installation tokens (`ghs_`) and fine-grained PATs (`github_pat_`) use a
 * fixed-permissions model instead and never populate that header; treating
 * its absence as "missing project scope" would reject a token that is
 * actually fine, so those token shapes skip this check entirely (matching
 * the sibling plugins' github-client.ts). */
function tokenHasOAuthScopeModel(token: string): boolean {
  return token.startsWith('ghp_') || token.startsWith('gho_');
}

/** Checked once per process. Names the missing scope explicitly instead of
 * surfacing GitHub's raw GraphQL permission error, so a Projects v2 write
 * fails with a typed, remediable error rather than a generic 403. Only
 * meaningful for classic OAuth-scoped tokens; App installation tokens and
 * fine-grained PATs skip the check and rely on the actual GraphQL call to
 * surface a real permission error if the token genuinely lacks access. */
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
  const scopesHeader = res.headers.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!scopes.includes('project')) {
    throw new BugCaptureError(
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
      // Paced on every attempt (including retries after a rate-limit wait),
      // not just the first -- a retry-after of 0 or a few seconds could
      // otherwise let back-to-back retries bypass the governor entirely.
      if (isMutating) {
        await enforceMutationPacing(sleep);
      }
      const token = resolveToken();
      const res = await fetchImpl(GITHUB_GRAPHQL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });
      const json = (await handleResponse(res)) as GraphQLResponse<T>;
      if (json.errors?.length) {
        throw new BugCaptureError('github_api_error', `GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`, {
          graphqlErrors: json.errors,
        });
      }
      if (json.data === undefined) {
        throw new BugCaptureError('github_api_error', 'GitHub GraphQL response had no data and no errors');
      }
      return json.data;
    },
    sleep,
  );
}
