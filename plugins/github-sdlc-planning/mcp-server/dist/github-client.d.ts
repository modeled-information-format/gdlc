export type ExecFileSyncFn = (command: string, args: string[], options: {
    encoding: 'utf8';
}) => string;
/** Auth: env var first, `gh auth token` fallback (assumption #2 in the build
 * plan). Fails fast with a remediation message rather than a raw 401.
 * `execImpl` is injectable so tests can exercise the fallback path without
 * mocking the `node:child_process` builtin. */
export declare function resolveToken(execImpl?: ExecFileSyncFn): string;
/** Checked once per process. AC-4: name the missing scope explicitly instead
 * of surfacing GitHub's raw GraphQL permission error. */
export declare function assertProjectScope(fetchImpl?: typeof fetch): Promise<void>;
/** Test-only: reset module-level auth cache between test cases. */
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
