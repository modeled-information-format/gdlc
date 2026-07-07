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
 * tests. Resolves fresh on every call instead: `execFileSync('gh', ['auth',
 * 'token'])` is one subprocess spawn per tool call, not a hot loop, and
 * removing the cache removes the whole stale-credential bug class rather
 * than patching around it. */
export declare function resolveToken(execImpl?: ExecFileSyncFn): string;
/** Checked once per process. AC-4: name the missing scope explicitly instead
 * of surfacing GitHub's raw GraphQL permission error. Only meaningful for
 * classic OAuth-scoped tokens; App installation tokens and fine-grained PATs
 * skip this check and rely on the actual GraphQL call to surface a real
 * permission error if the token genuinely lacks access. */
export declare function assertProjectScope(fetchImpl?: typeof fetch): Promise<void>;
/** Test-only: reset the project-scope-checked flag and mutation-pacing state
 * between test cases. `resolveToken` itself no longer caches (issue #105),
 * so there is nothing token-related left to reset here -- kept under its
 * original name since callers already depend on it running between tests. */
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
