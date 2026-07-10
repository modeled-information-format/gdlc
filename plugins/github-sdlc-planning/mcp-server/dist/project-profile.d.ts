/**
 * XDG-config durable project-profile layer (gdlc#199/#200-and-friends'
 * originating forensic report, root cause #3): a machine-populated cache of
 * a GitHub Projects v2 board's REAL `Status` field schema, plus a standing
 * user-preferences file recording how this workspace resolves the
 * documented-lifecycle-vs-real-board mismatch. Distinct from `config.ts`'s
 * `gdlc/config.yml` layered config (user-authored settings): this module
 * caches values discovered at runtime via GraphQL, never hand-written.
 *
 * Deliberately dependency-free (only `node:fs`/`node:path`/`node:crypto`
 * builtins, plus `xdg.ts`'s `resolveGlobalConfigRoot`, which is itself
 * `node:os`/`node:path` builtins only) so this file can be imported two
 * ways without creating a new cross-plugin dependency the hygiene-hook
 * drift-check doesn't expect. Copilot review finding: an earlier revision
 * imported `resolveGlobalConfigRoot` from `config.ts` instead, which
 * unconditionally imports the `yaml` package at module scope for its own
 * needs -- loading this module the second way below (bare-node, no
 * node_modules) would have transitively tried to load `yaml` and crashed,
 * exactly what "dependency-free" was supposed to rule out. `xdg.ts` holds
 * only the one function actually needed here, with no such coupling:
 *   - directly from this plugin's own `src/*.ts` (this module compiles
 *     alongside them, e.g. `tools/projects.ts`);
 *   - from a bare-node hook script via this package's built
 *     `dist/project-profile.js`, the same "hook imports built dist
 *     directly" precedent `hooks/validate-mif.mjs` already established for
 *     `dist/mif.js` (see that file's own doc comment) — no `node_modules`
 *     resolution involved either way, just a relative file path.
 * Exported via this package's `package.json` `exports["./project-profile"]`
 * so a sibling plugin could resolve it the same way `github-pull-requests`
 * resolves `@github-sdlc-plugins/github-sdlc-planning-mcp-server/tools/projects`
 * today, though no Story in this batch requires that.
 *
 * Every filesystem call is dependency-injected (same DI shape as this
 * plugin's other readers, e.g. `config.ts`'s `existsFn`) so tests never
 * touch a developer's real `$HOME`.
 */
export type ProjectProfileEnv = Partial<Pick<NodeJS.ProcessEnv, 'XDG_CONFIG_HOME'>>;
export interface StatusFieldOption {
    id: string;
    name: string;
}
export interface StatusFieldSchema {
    id: string;
    name: string;
    options: StatusFieldOption[];
}
export interface ProjectProfile {
    /** ISO-8601 timestamp of when this profile was last (re)populated. */
    updatedAt: string;
    /** `null` when the project has no single-select field named `Status` at
     * all (an unusually-shaped board) -- distinct from a `Status` field with
     * zero options, which is `{..., options: []}`. */
    statusField: StatusFieldSchema | null;
    /** The subset of `DOCUMENTED_LIFECYCLE_STAGES` with no matching
     * `statusField.options[].name` -- computed once at write time so a reader
     * never has to recompute the set difference itself. Equals every
     * documented stage when `statusField` is `null`. */
    missingLifecycleStages: string[];
}
/** The 5-stage lifecycle CLAUDE.md documents (Backlog/Ready/In Progress/
 * In Review/Done) -- kept here as the one place that enumerates it for this
 * cache, so `computeMissingLifecycleStages` and any future reconciliation
 * logic never drift from each other. This workspace's real org board is
 * confirmed (forensics report root cause #3) to use a *different* 5-stage
 * set (Todo/In Progress/In Review/Blocked/Done); the whole point of this
 * cache is making that mismatch durable and machine-readable instead of a
 * silent, once-per-session rediscovery. */
export declare const DOCUMENTED_LIFECYCLE_STAGES: readonly ["Backlog", "Ready", "In Progress", "In Review", "Done"];
/** One hour: short enough that a board-schema edit (a Status option
 * renamed/added/removed) is picked up within a session or two, long enough
 * that a hot loop of `get_project_items` calls in one session doesn't
 * re-fetch the field schema on every call. */
export declare const DEFAULT_PROJECT_PROFILE_TTL_MS: number;
export declare function computeMissingLifecycleStages(optionNames: readonly string[]): string[];
/** `${XDG_CONFIG_HOME:-$HOME/.config}/gdlc/projects/<org>/<project-number>.json` --
 * the XDG Base Directory spec's own env-var-or-default rule, delegated to
 * `config.ts#resolveGlobalConfigRoot` (already honors it identically) rather
 * than re-implemented a second time in this file. */
export declare function projectProfilePath(projectOwnerLogin: string, projectNumber: number, env?: ProjectProfileEnv): string;
/** `${XDG_CONFIG_HOME:-$HOME/.config}/gdlc/user.json`. */
export declare function userPrefsPath(env?: ProjectProfileEnv): string;
export interface FsDeps {
    existsFn?: (path: string) => boolean;
    readFn?: (path: string) => string;
    writeFn?: (path: string, contents: string) => void;
    renameFn?: (from: string, to: string) => void;
    mkdirFn?: (path: string) => void;
}
/** Reads the cached profile for one project, or `null` if missing,
 * unreadable, or malformed. Does not consider TTL -- callers that care
 * about freshness pair this with `isProjectProfileFresh`, matching this
 * module's other read/validate-freshness split. Exported for tests and for
 * any future direct caller (e.g. a diagnostic tool) that wants the raw
 * cached value regardless of staleness. */
export declare function readProjectProfile(projectOwnerLogin: string, projectNumber: number, env?: ProjectProfileEnv, fs?: FsDeps): ProjectProfile | null;
export declare function isProjectProfileFresh(profile: ProjectProfile, now?: number, ttlMs?: number): boolean;
/** Writes the profile atomically (see `writeJsonAtomic`), stamping
 * `updatedAt` with the current time and deriving `missingLifecycleStages`
 * from `statusField` itself -- a caller only ever needs to supply
 * `statusField`, never compute the derived field by hand (and can never
 * pass a `missingLifecycleStages` that's out of sync with `statusField`,
 * since there's no parameter for it). */
export declare function writeProjectProfile(projectOwnerLogin: string, projectNumber: number, statusField: StatusFieldSchema | null, env?: ProjectProfileEnv, fs?: FsDeps, now?: () => number): ProjectProfile;
/** WHEN a cached profile exists and is still fresh, THEN return it as-is
 * with no network call. WHEN it's missing or stale, THEN call
 * `fetchStatusField` (the caller's GraphQL field-schema round trip -- this
 * module never talks to GitHub itself) and persist the result before
 * returning it, so the next call in or outside this process gets the fresh
 * value from disk without refetching. `fetchStatusField` returning `null`
 * (the project has no `Status` single-select field) is cached exactly like
 * a real result -- an unusually-shaped board doesn't need re-probing every
 * TTL window either. */
export declare function getOrRefreshProjectProfile(projectOwnerLogin: string, projectNumber: number, fetchStatusField: () => Promise<StatusFieldSchema | null>, options?: {
    env?: ProjectProfileEnv;
    fs?: FsDeps;
    now?: () => number;
    ttlMs?: number;
}): Promise<ProjectProfile>;
export interface UserPrefs {
    /** Forensics report root cause #3's user decision, persisted so future
     * sessions in other org repos with their own board-vs-doc mismatches
     * don't need to re-ask: the *documentation* adapts to a project's real
     * board, never the other way around. */
    lifecycleReconciliation: 'doc-follows-board';
}
export declare const DEFAULT_USER_PREFS: UserPrefs;
/** Reads the raw file, or `null` if missing/unreadable/malformed --
 * mirroring `readProjectProfile`'s contract. Exported for tests and for a
 * caller that wants to distinguish "never written" from "written with
 * defaults" (`ensureUserPrefs` collapses that distinction on purpose). */
export declare function readUserPrefs(env?: ProjectProfileEnv, fs?: FsDeps): UserPrefs | null;
export declare function writeUserPrefs(prefs: UserPrefs, env?: ProjectProfileEnv, fs?: FsDeps): void;
/** First-use creation: WHEN `user.json` doesn't exist yet (or is
 * malformed), THEN seed it with `DEFAULT_USER_PREFS` and return that.
 * WHEN it already holds a valid value, THEN return it unchanged -- this
 * never overwrites a value the user (or a prior session) already set. */
export declare function ensureUserPrefs(env?: ProjectProfileEnv, fs?: FsDeps): UserPrefs;
