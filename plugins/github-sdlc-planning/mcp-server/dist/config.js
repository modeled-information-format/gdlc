import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
const CONFIG_RELPATH = ['gdlc', 'config.yml'];
/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export function resolveConfigPath(root) {
    return join(root, ...CONFIG_RELPATH);
}
export function resolveGlobalConfigRoot(env = process.env) {
    return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
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
/** Load and merge both layers. `projectRoot` defaults to `process.cwd()`
 * (the running tool's project root); `env` defaults to `process.env` (for
 * `XDG_CONFIG_HOME`, tests inject a fake one). The project layer's file is
 * `<projectRoot>/.config/gdlc/config.yml` -- `resolveConfigPath` is given
 * `<projectRoot>/.config` as its root, not `projectRoot` itself, since
 * `$XDG_CONFIG_HOME` (the global root) already points at what `.config`
 * conceptually is for the global layer. */
export function loadGdlcConfig(projectRoot = process.cwd(), env = process.env) {
    const global = loadConfigFile(resolveConfigPath(resolveGlobalConfigRoot(env)));
    const project = loadConfigFile(resolveConfigPath(join(projectRoot, '.config')));
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
//# sourceMappingURL=config.js.map