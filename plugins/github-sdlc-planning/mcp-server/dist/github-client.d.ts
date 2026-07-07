export type ExecFileSyncFn = (command: string, args: string[], options: {
    encoding: 'utf8';
}) => string;
/** Auth: env var first, `gh auth token` fallback (assumption #2 in the build
 * plan). Fails fast with a remediation message rather than a raw 401.
 * `execImpl` is injectable so tests can exercise the fallback path without
 * mocking the `node:child_process` builtin.
 *
 * Issue #105: this used to cache the resolved token in a module-level
 * variable for the life of the process, so a `gh auth switch` (or any
 * env/credential change) mid-session kept resolving to the stale account
 * until the MCP server was restarted -- with no invalidation path outside
 * tests. Resolves fresh on every call instead, removing that whole
 * stale-credential bug class rather than patching around it. Cost, measured
 * via impartial review: this is one `execFileSync('gh', ['auth', 'token'])`
 * subprocess spawn per `githubRest`/`githubGraphQL` call, not per tool
 * invocation as an earlier version of this comment claimed -- a single tool
 * call can trigger several REST/GraphQL round trips (`addSubIssue` alone can
 * call `resolveToken` 5-14 times), multiplied further by bulk callers like
 * epic-decomposition. Accepted anyway when `GITHUB_TOKEN` is unset: `gh auth
 * token` reads a local cached credential, not a network round trip, and the
 * issue that requested this fix explicitly weighed and accepted this exact
 * tradeoff over reintroducing a cache. */
export declare function resolveToken(execImpl?: ExecFileSyncFn): string;
/** Checked once per resolved token, not once per process. AC-4: name the
 * missing scope explicitly instead of surfacing GitHub's raw GraphQL
 * permission error. Only meaningful for classic OAuth-scoped tokens; App
 * installation tokens and fine-grained PATs skip this check and rely on the
 * actual GraphQL call to surface a real permission error if the token
 * genuinely lacks access.
 *
 * Impartial-review finding on #105: this used to be a bare per-process
 * boolean, which -- after #105's fix made `resolveToken` re-resolve fresh on
 * every call -- became its own stale-credential bug: a `gh auth switch` to
 * an account lacking `project` scope would still short-circuit past this
 * check on the stale `true`, and the caller would get a raw GraphQL
 * permission error instead of this function's friendly `missing_scope`.
 * Keying the cache by the resolved token value (not a boolean) fixes that
 * while still avoiding a repeat `/user` call for the common case of the same
 * token making many calls in a row. */
export declare function assertProjectScope(fetchImpl?: typeof fetch): Promise<void>;
/** Test-only: reset the project-scope-checked-for-token cache and
 * mutation-pacing state between test cases. `resolveToken` itself no longer
 * caches (issue #105), so there is nothing token-resolution-related left to
 * reset here -- kept under its original name since callers already depend
 * on it running between tests. */
export declare function resetAuthCacheForTests(): void;
interface RestOptions {
    method?: string;
    body?: unknown;
}
export interface GithubClientDeps {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
}
export declare function githubRest(path: string, opts?: RestOptions, deps?: GithubClientDeps): Promise<unknown>;
export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{
        message: string;
        extensions?: Record<string, unknown>;
    }>;
}
export interface GraphQLOptions {
    /** Preview header value to send on the first attempt; retried once without
     * it on a schema error (Edge Case: preview-header retirement). */
    previewHeader?: string;
}
export declare function githubGraphQL<T = unknown>(query: string, variables?: Record<string, unknown>, opts?: GraphQLOptions, deps?: GithubClientDeps): Promise<T>;
export {};
