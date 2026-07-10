import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { parse } from 'yaml';
import { resolveGlobalConfigRoot } from './xdg.js';
export { resolveGlobalConfigRoot };
const CONFIG_RELPATH = ['gdlc', 'config.yml'];
/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export function resolveConfigPath(root) {
    return join(root, ...CONFIG_RELPATH);
}
/** Issue #106 / ADR-0005: search upward from `startDir` toward the
 * filesystem root for `<dir>/.config/gdlc/config.yml`, git-style (the same
 * pattern git/npm/tsconfig use to find a project root from a nested cwd).
 * Fixes the case where the MCP server's cwd is a SUBdirectory of the
 * project root (e.g. launched from `<project>/src`) -- climbing toward the
 * root correctly finds the ancestor project root in that direction.
 *
 * It does NOT fix the specific topology issue #106 reported: a multi-repo
 * workspace cwd (e.g. `modeled-information-format/`) that is an ANCESTOR of
 * the actual project directory (`modeled-information-format/repos/gdlc/`),
 * not nested inside it. Climbing further up from an ancestor only moves
 * away from a descendant project's config, never toward it -- no purely
 * upward search can resolve that direction; see ADR-0005 for the residual
 * gap and its documented workaround. Returns `null` if no ancestor (inclusive
 * of `startDir` itself) has the file by the time the filesystem root is
 * reached.
 *
 * `ceiling` (default `homedir()`) stops the climb before checking that
 * directory at all -- impartial-review finding: the user's home directory is
 * never a legitimate project root, and for any cwd under it (virtually
 * always true), an unbounded climb would eventually check
 * `homedir()/.config/gdlc/config.yml`, the OS-default global-layer path
 * (`resolveGlobalConfigRoot`'s fallback when `XDG_CONFIG_HOME` is unset).
 * Left unguarded, a stray leftover file at that default location -- e.g.
 * from before an `XDG_CONFIG_HOME` customization -- would be silently
 * treated as a project-specific config and, per `mergeConfigs`'s
 * project-always-wins semantics, would outrank the real, intentionally
 * configured global layer. */
export function findProjectConfigRoot(startDir, existsFn = existsSync, ceiling = homedir()) {
    const ceilingResolved = resolvePath(ceiling);
    let dir = resolvePath(startDir);
    for (;;) {
        if (dir === ceilingResolved)
            return null;
        if (existsFn(resolveConfigPath(join(dir, '.config'))))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            return null;
        dir = parent;
    }
}
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Every entry is coerced to a string -- never dropped, even a non-scalar
 * one (`null`, an object, a nested array) -- so a non-empty input array can
 * never normalize down to `[]`. Dropping entries (the initial version of
 * this function only coerced scalars and dropped the rest) can still empty
 * the array when *every* entry is non-scalar (e.g. `[null]`, `[{a: 1}]`),
 * and `isRepoAllowed` treats an empty allowlist as "no restriction" --
 * exactly backwards for a scope-limiting allowlist. A coerced entry
 * ("false", "123", "null", "[object Object]") won't match a real org/repo
 * name, which fails closed (over-restrictive) instead of open, and
 * preserving the entry count means "empty" only ever means "genuinely
 * configured empty," never "everything in it was malformed." */
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return undefined;
    return value.map((v) => (typeof v === 'string' ? v : String(v)));
}
/** Normalize a parsed YAML document into a `GdlcConfig`, dropping anything
 * that doesn't match the schema (schema/gdlc-config.schema.json) rather than
 * throwing -- fail-soft, same convention as the hooks-layer readers. */
function normalizeConfig(parsed) {
    if (!isPlainObject(parsed))
        return {};
    const config = {};
    if (isPlainObject(parsed.targeting)) {
        const allowRepos = normalizeStringArray(parsed.targeting.allowRepos);
        const allowOrgs = normalizeStringArray(parsed.targeting.allowOrgs);
        if (allowRepos !== undefined || allowOrgs !== undefined) {
            config.targeting = { ...(allowRepos !== undefined && { allowRepos }), ...(allowOrgs !== undefined && { allowOrgs }) };
        }
    }
    if (isPlainObject(parsed.destination) && typeof parsed.destination.repo === 'string') {
        config.destination = { repo: parsed.destination.repo };
    }
    if (isPlainObject(parsed.board)) {
        const { projectOwnerLogin, projectNumber, projectOwnerType } = parsed.board;
        const board = {};
        if (typeof projectOwnerLogin === 'string' && projectOwnerLogin !== '')
            board.projectOwnerLogin = projectOwnerLogin;
        // Accept a quoted numeric string ("4") as well as a bare YAML integer:
        // the hooks-layer reader (in-progress.mjs) can't distinguish YAML types
        // (it's a dependency-free regex parser, everything captured is text) and
        // always coerces via Number(); matching that here keeps the two
        // independent readers resolving the same file identically.
        if (typeof projectNumber === 'number' || typeof projectNumber === 'string') {
            const parsedNumber = Number(projectNumber);
            if (Number.isInteger(parsedNumber) && parsedNumber > 0)
                board.projectNumber = parsedNumber;
        }
        if (projectOwnerType === 'organization' || projectOwnerType === 'user')
            board.projectOwnerType = projectOwnerType;
        if (Object.keys(board).length > 0)
            config.board = board;
    }
    if (isPlainObject(parsed.packs)) {
        const packs = {};
        for (const [key, value] of Object.entries(parsed.packs)) {
            if (typeof value === 'boolean')
                packs[key] = value;
        }
        if (Object.keys(packs).length > 0)
            config.packs = packs;
    }
    if (isPlainObject(parsed.prLifecycle)) {
        const raw = parsed.prLifecycle;
        const prLifecycle = {};
        if (typeof raw.enabled === 'boolean')
            prLifecycle.enabled = raw.enabled;
        // Copilot review finding: trim before validating, matching the
        // hooks-layer reader's extractScalarValue().trim() -- otherwise
        // localReviewer: "   " is accepted here (present, non-empty) but
        // dropped by the hooks reader (trims to '', treated as absent), the two
        // independent readers silently disagreeing about the same file.
        if (typeof raw.localReviewer === 'string' && raw.localReviewer.trim() !== '')
            prLifecycle.localReviewer = raw.localReviewer.trim();
        if (typeof raw.requireLocalReview === 'boolean')
            prLifecycle.requireLocalReview = raw.requireLocalReview;
        if (typeof raw.requireCopilotReview === 'boolean')
            prLifecycle.requireCopilotReview = raw.requireCopilotReview;
        if (typeof raw.requireCleanCodeScanning === 'boolean')
            prLifecycle.requireCleanCodeScanning = raw.requireCleanCodeScanning;
        if (typeof raw.gateNewWorkOnUnresolvedThreads === 'boolean')
            prLifecycle.gateNewWorkOnUnresolvedThreads = raw.gateNewWorkOnUnresolvedThreads;
        if (Object.keys(prLifecycle).length > 0)
            config.prLifecycle = prLifecycle;
    }
    return config;
}
/** Read and parse one layer's `gdlc/config.yml`. A missing file, an
 * unreadable file, or a YAML syntax error are all an empty config, not a
 * thrown error -- a hooks-style fail-soft reader. Exported for tests. */
export function loadConfigFile(path) {
    let text;
    try {
        text = readFileSync(path, 'utf8');
    }
    catch {
        return {};
    }
    try {
        return normalizeConfig(parse(text));
    }
    catch {
        return {};
    }
}
/** Merge two layers **per top-level section**: a section present in
 * `project` replaces that section from `global` wholly (no leaf-key or
 * array merging) -- ADR-0004's "closer-to-project wins" direction, made
 * unambiguous for `allowRepos`/`allowOrgs` (issue #81's design). A plain
 * object spread implements this exactly, because `normalizeConfig` only
 * ever assigns a section key when it has a real value -- never `undefined`
 * -- so `project`'s own keys always take precedence and `global`'s show
 * through only where `project` has no key at all. */
export function mergeConfigs(global, project) {
    return { ...global, ...project };
}
/** Where the project layer's config file was found, for callers that want to
 * surface it as a diagnostic (issue #106: the prior silent cwd-mismatch gap
 * had no observable signal at all). `null` means no ancestor of `startDir`
 * had `.config/gdlc/config.yml` -- distinct from a found-but-empty file.
 *
 * Impartial-review finding: `findProjectConfigRoot`'s `homedir()` ceiling
 * (see that function's doc comment) already stops the search from wandering
 * into the OS-default global-layer location. This second guard handles the
 * narrower remaining case: a `XDG_CONFIG_HOME` customized to some OTHER
 * directory that the upward search still happens to reach (e.g. it ends in
 * `/.config` at a shared ancestor of `startDir`). Excluding an exact path
 * match against whatever the CURRENT session's global root actually
 * resolves to closes that gap too, so a project-layer "find" can never be
 * literally the same file the global layer is already reading -- which
 * would otherwise let it silently outrank the real global config, since
 * `mergeConfigs` always lets "project" win. */
export function resolveProjectConfigPath(startDir = process.cwd(), existsFn = existsSync, env = process.env) {
    const root = findProjectConfigRoot(startDir, existsFn);
    if (root === null)
        return null;
    const path = resolveConfigPath(join(root, '.config'));
    return path === resolveConfigPath(resolveGlobalConfigRoot(env)) ? null : path;
}
/** Load and merge both layers. `projectRoot` defaults to `process.cwd()`
 * (the running tool's project root); `env` defaults to `process.env` (for
 * `XDG_CONFIG_HOME`, tests inject a fake one). Issue #106: `projectRoot` is
 * only the SEARCH START, not necessarily where the file is found --
 * `resolveProjectConfigPath` climbs upward from it first, and excludes a
 * match against the global layer's own path (see that function's doc
 * comment, and ADR-0005 for what the upward search does and does not fix).
 * `existsFn` is injectable (default `existsSync`) so a test asserting
 * "nothing found anywhere" doesn't have to walk the real filesystem to its
 * root, which would risk a false match against whatever the test-running
 * machine's real ancestor directories happen to contain. */
export function loadGdlcConfig(projectRoot = process.cwd(), env = process.env, existsFn = existsSync) {
    const global = loadConfigFile(resolveConfigPath(resolveGlobalConfigRoot(env)));
    const projectPath = resolveProjectConfigPath(projectRoot, existsFn, env);
    const project = projectPath === null ? {} : loadConfigFile(projectPath);
    return mergeConfigs(global, project);
}
/** Resolve board coordinates from explicit tool-call arguments or config,
 * atomically: `projectOwnerLogin`/`projectNumber` together identify ONE
 * board, so they're taken as a pair, never mixed field-by-field across
 * sources. If the caller supplies both explicitly, config is not
 * consulted for either. If the caller supplies neither, both come from
 * config's `board` section. If the caller supplies exactly one -- an
 * inconsistent partial call -- this returns `undefined` rather than
 * pairing that one explicit field with the other field from config, which
 * could silently combine two unrelated boards' coordinates.
 * `projectOwnerType` is a secondary refinement of whichever pair won, not
 * part of the identifying pair, so it defaults independently. Returns
 * `undefined` when no complete pair resolves -- the caller decides
 * whether that's an error. */
export function resolveBoardCoordinates(explicit, config) {
    const hasExplicitLogin = explicit.projectOwnerLogin !== undefined;
    const hasExplicitNumber = explicit.projectNumber !== undefined;
    let projectOwnerLogin;
    let projectNumber;
    if (hasExplicitLogin && hasExplicitNumber) {
        projectOwnerLogin = explicit.projectOwnerLogin;
        projectNumber = explicit.projectNumber;
    }
    else if (!hasExplicitLogin && !hasExplicitNumber) {
        projectOwnerLogin = config.board?.projectOwnerLogin;
        projectNumber = config.board?.projectNumber;
    }
    else {
        return undefined;
    }
    if (projectOwnerLogin === undefined || projectNumber === undefined)
        return undefined;
    const projectOwnerType = explicit.projectOwnerType ?? config.board?.projectOwnerType;
    return { projectOwnerLogin, projectNumber, ...(projectOwnerType !== undefined && { projectOwnerType }) };
}
/** Split a configured `destination.repo` ("org/repo") into parts, or
 * `undefined` if unset or malformed. */
export function resolveDestinationRepo(config) {
    const value = config.destination?.repo;
    if (typeof value !== 'string')
        return undefined;
    const parts = value.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1])
        return undefined;
    return { owner: parts[0], repo: parts[1] };
}
/** True when no `targeting` allowlist is configured at all (no
 * restriction), or when `owner/repo` matches `allowRepos` or `owner`
 * matches `allowOrgs`. */
export function isRepoAllowed(config, owner, repo) {
    const targeting = config.targeting;
    if (!targeting)
        return true;
    const { allowRepos, allowOrgs } = targeting;
    const hasAnyAllowlist = (allowRepos && allowRepos.length > 0) || (allowOrgs && allowOrgs.length > 0);
    if (!hasAnyAllowlist)
        return true;
    if (allowRepos?.includes(`${owner}/${repo}`))
        return true;
    if (allowOrgs?.includes(owner))
        return true;
    return false;
}
/** Fail-closed by design (ADR-0006): a missing `packs` section, a missing
 * key, or a non-`true` value all mean disabled. Matches the fail-closed
 * contract `github-bug-capture`'s hooks-layer reader implements
 * independently (dependency-free, so it can't import this module). */
export function isPackEnabled(config, pack) {
    return config.packs?.[pack] === true;
}
const DEFAULT_LOCAL_REVIEWER = '/code-review:code-review --fix';
/** Applies defaults to the raw `prLifecycle` section (issue #185/#186).
 * `enabled` defaults to `false` -- an absent or malformed section means the
 * feature is off, matching every other opt-in surface in this codebase
 * (`packs`, `skipMutationConfirm`): a repo that has never heard of this
 * feature does not suddenly get new hook prompts. Once `enabled: true`, the
 * three `require*` sub-toggles each default to `true` (enforce everything)
 * and `localReviewer` defaults to the org's own `/code-review:code-review
 * --fix` convention -- opting in without naming every field gets the
 * strictest sane behavior, not a silently-partial one.
 *
 * Important: `localReviewer` is a value a *hook* reads and surfaces to the
 * agent as an instruction (`permissionDecisionReason`) -- a hook can only
 * spawn an OS process (node/bash), it cannot invoke a Claude Code slash
 * command or skill. Nothing in this module or its callers ever executes
 * `localReviewer` as a shell command; treating it as directly executable
 * would silently do nothing (or run the literal string as a binary name and
 * fail) instead of enforcing anything. See
 * `plugins/github-pull-requests/hooks/pr-lifecycle-gate.mjs` for the
 * consuming hook and its own doc comment on this same constraint. */
export function resolvePrLifecycleConfig(config) {
    const raw = config.prLifecycle ?? {};
    return {
        enabled: raw.enabled === true,
        localReviewer: raw.localReviewer ?? DEFAULT_LOCAL_REVIEWER,
        requireLocalReview: raw.requireLocalReview ?? true,
        requireCopilotReview: raw.requireCopilotReview ?? true,
        requireCleanCodeScanning: raw.requireCleanCodeScanning ?? true,
        gateNewWorkOnUnresolvedThreads: raw.gateNewWorkOnUnresolvedThreads ?? true,
    };
}
//# sourceMappingURL=config.js.map