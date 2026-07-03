import { execFileSync } from 'node:child_process';
import { PlanningError } from './errors.js';
const GITHUB_API = 'https://api.github.com';
const GITHUB_GRAPHQL = 'https://api.github.com/graphql';
const API_VERSION = '2022-11-28';
const MAX_RATE_LIMIT_RETRIES = 3;
let cachedToken;
let projectScopeChecked = false;
const defaultExecFileSync = (command, args, options) => execFileSync(command, args, options);
/** Auth: env var first, `gh auth token` fallback (assumption #2 in the build
 * plan). Fails fast with a remediation message rather than a raw 401.
 * `execImpl` is injectable so tests can exercise the fallback path without
 * mocking the `node:child_process` builtin. */
export function resolveToken(execImpl = defaultExecFileSync) {
    if (cachedToken)
        return cachedToken;
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
    }
    catch {
        // fall through to the error below
    }
    throw new PlanningError('missing_scope', 'No GitHub token available. Set GITHUB_TOKEN, or run `gh auth login --scopes project`.');
}
/** Classic PATs (`ghp_`) and OAuth App user tokens (`gho_`) carry the
 * `X-OAuth-Scopes` response header the check below reads. GitHub App
 * installation tokens (`ghs_`) and fine-grained PATs (`github_pat_`) use a
 * fixed-permissions model instead — they never populate that header, and
 * treating its absence as "missing project scope" was a real bug (found via
 * live-integration-tests.yml run 28672305852: an `issues` App installation
 * token, correctly granted org:projects write, was rejected here). */
function tokenHasOAuthScopeModel(token) {
    return token.startsWith('ghp_') || token.startsWith('gho_');
}
/** Checked once per process. AC-4: name the missing scope explicitly instead
 * of surfacing GitHub's raw GraphQL permission error. Only meaningful for
 * classic OAuth-scoped tokens; App installation tokens and fine-grained PATs
 * skip this check and rely on the actual GraphQL call to surface a real
 * permission error if the token genuinely lacks access. */
export async function assertProjectScope(fetchImpl = fetch) {
    if (projectScopeChecked)
        return;
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
        throw new PlanningError('missing_scope', 'GitHub token is missing the `project` scope required for Projects v2 writes. Run `gh auth login --scopes project`.', { missingScope: 'project', presentScopes: scopes });
    }
    projectScopeChecked = true;
}
/** Deterministic governor, not incidental pacing from how fast a given agent
 * happens to call tools: GitHub's secondary (abuse-detection) rate limit for
 * content-creating mutations is undocumented in /rate_limit and triggers on
 * burst *pattern*, not primary-budget exhaustion (confirmed live: a
 * 5-run/40-minute burst of create-branch+commit+PR tripped it with 4939/5000
 * of the primary REST budget still unused). A reactive catch-403-and-retry
 * loop alone isn't sufficient for a tool whose real jobs (epic-decomposition,
 * bulk sub-issue seeding) intentionally create many objects in sequence.
 * MIN_MUTATION_INTERVAL_MS caps mutating calls at 60/minute, comfortably
 * under GitHub's informally documented ~80/minute secondary-limit guidance,
 * enforced here unconditionally regardless of which MCP host or model is
 * driving the calls. */
const MIN_MUTATION_INTERVAL_MS = 1000;
let lastMutationAt = 0;
/** Serializes concurrent enforceMutationPacing() calls: each invocation
 * chains onto the previous one's completion, so the check-then-update of
 * lastMutationAt can never race even if callers fire mutations via
 * Promise.all (Copilot review finding: an unserialized shared timestamp lets
 * two concurrent mutations both observe the same "enough time has passed"
 * state and proceed without sleeping). */
let mutationGate = Promise.resolve();
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function enforceMutationPacing(sleep) {
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
function isGraphQLMutation(query) {
    const withoutComments = query
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
    return withoutComments.trim().startsWith('mutation');
}
/** Test-only: reset module-level auth cache and mutation-pacing state between
 * test cases. */
export function resetAuthCacheForTests() {
    cachedToken = undefined;
    projectScopeChecked = false;
    lastMutationAt = 0;
    mutationGate = Promise.resolve();
}
class RateLimitError extends Error {
    retryAfterSeconds;
    constructor(retryAfterSeconds) {
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
function parseRetryAfterSeconds(header) {
    if (!header)
        return DEFAULT_RETRY_AFTER_SECONDS;
    const asSeconds = Number(header);
    if (Number.isFinite(asSeconds) && asSeconds >= 0)
        return asSeconds;
    const asDate = Date.parse(header);
    if (!Number.isNaN(asDate)) {
        return Math.max(0, Math.round((asDate - Date.now()) / 1000));
    }
    return DEFAULT_RETRY_AFTER_SECONDS;
}
async function withRateLimitBackoff(fn, sleep, attempt = 0) {
    try {
        return await fn();
    }
    catch (err) {
        if (err instanceof RateLimitError && attempt < MAX_RATE_LIMIT_RETRIES) {
            await sleep(err.retryAfterSeconds * 1000);
            return withRateLimitBackoff(fn, sleep, attempt + 1);
        }
        throw err;
    }
}
/** 429 ("Too Many Requests") is unambiguously rate-limiting, with or without
 * a retry-after header. 403 ("Forbidden") is ambiguous -- GitHub returns it
 * for genuine rate limits (primary and secondary, both of which set
 * retry-after) AND for ordinary permission-denied errors that have nothing
 * to do with rate limiting. Treating every 403 as rate-limited (the
 * original bug) discarded the real response body and wasted up to 3 retries
 * (180s+) surfacing a misleading "Rate limited" message for errors that
 * were never about rate limiting at all -- only require retry-after to be
 * present for a 403 specifically. */
async function handleResponse(res) {
    const retryAfter = res.headers.get('retry-after');
    if (res.status === 429 || (res.status === 403 && retryAfter !== null)) {
        throw new RateLimitError(parseRetryAfterSeconds(retryAfter));
    }
    if (!res.ok) {
        const text = await res.text();
        throw new PlanningError('github_api_error', `GitHub API error ${res.status}: ${text}`, {
            status: res.status,
        });
    }
    if (res.status === 204)
        return undefined;
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
}
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function githubRest(path, opts = {}, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const method = (opts.method ?? 'GET').toUpperCase();
    const isMutating = MUTATING_METHODS.has(method);
    return withRateLimitBackoff(async () => {
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
    }, sleep);
}
export async function githubGraphQL(query, variables = {}, opts = {}, deps = {}) {
    const fetchImpl = deps.fetchImpl ?? fetch;
    const sleep = deps.sleep ?? defaultSleep;
    const isMutating = isGraphQLMutation(query);
    return withRateLimitBackoff(async () => {
        if (isMutating) {
            await enforceMutationPacing(sleep);
        }
        const token = resolveToken();
        const headers = {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        };
        if (opts.previewHeader)
            headers['GraphQL-Features'] = opts.previewHeader;
        const res = await fetchImpl(GITHUB_GRAPHQL, {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables }),
        });
        const json = (await handleResponse(res));
        if (json.errors?.length) {
            const retryableSchemaError = json.errors.some((e) => /GraphQL-Features|Unknown argument|preview/i.test(e.message));
            if (opts.previewHeader && retryableSchemaError) {
                return githubGraphQL(query, variables, { ...opts, previewHeader: undefined }, deps);
            }
            throw new PlanningError('github_api_error', `GitHub GraphQL error: ${json.errors.map((e) => e.message).join('; ')}`, {
                graphqlErrors: json.errors,
            });
        }
        if (json.data === undefined) {
            throw new PlanningError('github_api_error', 'GitHub GraphQL response had no data and no errors');
        }
        return json.data;
    }, sleep);
}
//# sourceMappingURL=github-client.js.map