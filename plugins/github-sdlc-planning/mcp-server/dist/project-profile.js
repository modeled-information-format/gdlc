import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { resolveGlobalConfigRoot } from './config.js';
/** The 5-stage lifecycle CLAUDE.md documents (Backlog/Ready/In Progress/
 * In Review/Done) -- kept here as the one place that enumerates it for this
 * cache, so `computeMissingLifecycleStages` and any future reconciliation
 * logic never drift from each other. This workspace's real org board is
 * confirmed (forensics report root cause #3) to use a *different* 5-stage
 * set (Todo/In Progress/In Review/Blocked/Done); the whole point of this
 * cache is making that mismatch durable and machine-readable instead of a
 * silent, once-per-session rediscovery. */
export const DOCUMENTED_LIFECYCLE_STAGES = ['Backlog', 'Ready', 'In Progress', 'In Review', 'Done'];
/** One hour: short enough that a board-schema edit (a Status option
 * renamed/added/removed) is picked up within a session or two, long enough
 * that a hot loop of `get_project_items` calls in one session doesn't
 * re-fetch the field schema on every call. */
export const DEFAULT_PROJECT_PROFILE_TTL_MS = 60 * 60 * 1000;
export function computeMissingLifecycleStages(optionNames) {
    return DOCUMENTED_LIFECYCLE_STAGES.filter((stage) => !optionNames.includes(stage));
}
const PROJECTS_SUBDIR = ['gdlc', 'projects'];
const USER_PREFS_RELPATH = ['gdlc', 'user.json'];
/** GitHub org/user logins can't contain `/` or null bytes, but this still
 * refuses to let a caller-supplied login escape the `projects/` directory
 * via `..` or an absolute-path component -- defense in depth, since `login`
 * ultimately comes from a GraphQL response, not a hard-coded constant. */
function sanitizePathSegment(segment) {
    return segment.replace(/[\\/]/g, '_').replace(/^\.+/, '_');
}
/** `${XDG_CONFIG_HOME:-$HOME/.config}/gdlc/projects/<org>/<project-number>.json` --
 * the XDG Base Directory spec's own env-var-or-default rule, delegated to
 * `config.ts#resolveGlobalConfigRoot` (already honors it identically) rather
 * than re-implemented a second time in this file. */
export function projectProfilePath(projectOwnerLogin, projectNumber, env = process.env) {
    return join(resolveGlobalConfigRoot(env), ...PROJECTS_SUBDIR, sanitizePathSegment(projectOwnerLogin), `${projectNumber}.json`);
}
/** `${XDG_CONFIG_HOME:-$HOME/.config}/gdlc/user.json`. */
export function userPrefsPath(env = process.env) {
    return join(resolveGlobalConfigRoot(env), ...USER_PREFS_RELPATH);
}
const defaultFsDeps = {
    existsFn: existsSync,
    readFn: (path) => readFileSync(path, 'utf8'),
    writeFn: (path, contents) => writeFileSync(path, contents, 'utf8'),
    renameFn: renameSync,
    mkdirFn: (path) => {
        mkdirSync(path, { recursive: true });
    },
};
/** No existing writer in this codebase's config-file family handles
 * concurrent writes (`config.ts`/the hooks-layer readers are read-only;
 * `diagnostic-capture.mjs`'s lone `writeFileSync` is a single best-effort
 * offset marker, not a shared cache two processes could race on). This
 * cache genuinely can be written by two concurrent MCP-server processes
 * (e.g. two parallel tool calls against the same project), so a plain
 * `writeFileSync` risks a reader observing a half-written file. Write to a
 * uniquely-named sibling temp file first, then `rename` -- atomic on the
 * same filesystem (POSIX and NTFS both), so a concurrent reader only ever
 * sees the fully-old or fully-new file, never a torn write. */
function writeJsonAtomic(path, data, fns) {
    fns.mkdirFn(dirnamePortable(path));
    const tmpPath = `${path}.tmp-${process.pid}-${randomUUID()}`;
    fns.writeFn(tmpPath, `${JSON.stringify(data, null, 2)}\n`);
    fns.renameFn(tmpPath, path);
}
/** `node:path`'s `dirname` without importing it solely for this one call
 * would be a false economy -- imported at module scope like everything
 * else here; named to make the single call site below self-explanatory. */
function dirnamePortable(path) {
    const idx = path.lastIndexOf('/');
    return idx === -1 ? '.' : path.slice(0, idx);
}
function readJson(path, fns) {
    if (!fns.existsFn(path))
        return null;
    try {
        const parsed = JSON.parse(fns.readFn(path));
        return parsed;
    }
    catch {
        // Malformed file (partial write from a crashed process, hand-edited
        // garbage, ...): treated as absent, never thrown -- this is a cache,
        // not a source of truth, and a hook/tool must never break the caller
        // it's serving over a corrupt cache file.
        return null;
    }
}
function isStatusFieldOption(value) {
    return (typeof value === 'object' &&
        value !== null &&
        typeof value.id === 'string' &&
        typeof value.name === 'string');
}
/** Validates the shape read back off disk rather than trusting a bare cast
 * -- the file can be hand-edited or written by a future/older version of
 * this module. Any structural mismatch degrades to "no cached profile"
 * (`null`), never a thrown error, matching `readJson`'s own contract. */
function validateProjectProfile(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const candidate = value;
    if (typeof candidate.updatedAt !== 'string')
        return null;
    if (!Array.isArray(candidate.missingLifecycleStages) || !candidate.missingLifecycleStages.every((s) => typeof s === 'string')) {
        return null;
    }
    if (candidate.statusField !== null) {
        if (typeof candidate.statusField !== 'object' || candidate.statusField === undefined)
            return null;
        const field = candidate.statusField;
        if (typeof field.id !== 'string' || typeof field.name !== 'string' || !Array.isArray(field.options))
            return null;
        if (!field.options.every(isStatusFieldOption))
            return null;
    }
    return {
        updatedAt: candidate.updatedAt,
        statusField: candidate.statusField ?? null,
        missingLifecycleStages: candidate.missingLifecycleStages,
    };
}
/** Reads the cached profile for one project, or `null` if missing,
 * unreadable, or malformed. Does not consider TTL -- callers that care
 * about freshness pair this with `isProjectProfileFresh`, matching this
 * module's other read/validate-freshness split. Exported for tests and for
 * any future direct caller (e.g. a diagnostic tool) that wants the raw
 * cached value regardless of staleness. */
export function readProjectProfile(projectOwnerLogin, projectNumber, env = process.env, fs = {}) {
    const fns = { ...defaultFsDeps, ...fs };
    return validateProjectProfile(readJson(projectProfilePath(projectOwnerLogin, projectNumber, env), fns));
}
export function isProjectProfileFresh(profile, now = Date.now(), ttlMs = DEFAULT_PROJECT_PROFILE_TTL_MS) {
    const updatedAtMs = Date.parse(profile.updatedAt);
    if (Number.isNaN(updatedAtMs))
        return false; // malformed timestamp: never treated as fresh
    return now - updatedAtMs < ttlMs;
}
/** Writes the profile atomically (see `writeJsonAtomic`), stamping
 * `updatedAt` with the current time and deriving `missingLifecycleStages`
 * from `statusField` itself -- a caller only ever needs to supply
 * `statusField`, never compute the derived field by hand (and can never
 * pass a `missingLifecycleStages` that's out of sync with `statusField`,
 * since there's no parameter for it). */
export function writeProjectProfile(projectOwnerLogin, projectNumber, statusField, env = process.env, fs = {}, now = Date.now) {
    const fns = { ...defaultFsDeps, ...fs };
    const profile = {
        updatedAt: new Date(now()).toISOString(),
        statusField,
        missingLifecycleStages: computeMissingLifecycleStages(statusField?.options.map((o) => o.name) ?? []),
    };
    writeJsonAtomic(projectProfilePath(projectOwnerLogin, projectNumber, env), profile, fns);
    return profile;
}
/** WHEN a cached profile exists and is still fresh, THEN return it as-is
 * with no network call. WHEN it's missing or stale, THEN call
 * `fetchStatusField` (the caller's GraphQL field-schema round trip -- this
 * module never talks to GitHub itself) and persist the result before
 * returning it, so the next call in or outside this process gets the fresh
 * value from disk without refetching. `fetchStatusField` returning `null`
 * (the project has no `Status` single-select field) is cached exactly like
 * a real result -- an unusually-shaped board doesn't need re-probing every
 * TTL window either. */
export async function getOrRefreshProjectProfile(projectOwnerLogin, projectNumber, fetchStatusField, options = {}) {
    const env = options.env ?? process.env;
    const fs = options.fs ?? {};
    const now = options.now ?? Date.now;
    const ttlMs = options.ttlMs ?? DEFAULT_PROJECT_PROFILE_TTL_MS;
    const cached = readProjectProfile(projectOwnerLogin, projectNumber, env, fs);
    if (cached !== null && isProjectProfileFresh(cached, now(), ttlMs))
        return cached;
    const statusField = await fetchStatusField();
    return writeProjectProfile(projectOwnerLogin, projectNumber, statusField, env, fs, now);
}
export const DEFAULT_USER_PREFS = { lifecycleReconciliation: 'doc-follows-board' };
function isUserPrefs(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value.lifecycleReconciliation === 'doc-follows-board');
}
/** Reads the raw file, or `null` if missing/unreadable/malformed --
 * mirroring `readProjectProfile`'s contract. Exported for tests and for a
 * caller that wants to distinguish "never written" from "written with
 * defaults" (`ensureUserPrefs` collapses that distinction on purpose). */
export function readUserPrefs(env = process.env, fs = {}) {
    const fns = { ...defaultFsDeps, ...fs };
    const raw = readJson(userPrefsPath(env), fns);
    return isUserPrefs(raw) ? raw : null;
}
export function writeUserPrefs(prefs, env = process.env, fs = {}) {
    const fns = { ...defaultFsDeps, ...fs };
    writeJsonAtomic(userPrefsPath(env), prefs, fns);
}
/** First-use creation: WHEN `user.json` doesn't exist yet (or is
 * malformed), THEN seed it with `DEFAULT_USER_PREFS` and return that.
 * WHEN it already holds a valid value, THEN return it unchanged -- this
 * never overwrites a value the user (or a prior session) already set. */
export function ensureUserPrefs(env = process.env, fs = {}) {
    const existing = readUserPrefs(env, fs);
    if (existing !== null)
        return existing;
    writeUserPrefs(DEFAULT_USER_PREFS, env, fs);
    return DEFAULT_USER_PREFS;
}
//# sourceMappingURL=project-profile.js.map