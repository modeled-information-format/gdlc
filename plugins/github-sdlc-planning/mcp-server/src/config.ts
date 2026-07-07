import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { parse } from 'yaml';

/** gdlc's layered global/project config (epic #78, ADR-0004, issues #80-82).
 * Both layers share this shape and one path-joining rule:
 * `resolve(root) => path.join(root, 'gdlc', 'config.yml')`. The global
 * layer's root IS `$XDG_CONFIG_HOME` (default `~/.config`) directly, giving
 * `~/.config/gdlc/config.yml`; the project layer's root is the project's
 * own `.config` directory (`<projectRoot>/.config`), giving
 * `<projectRoot>/.config/gdlc/config.yml` -- see `loadGdlcConfig`, the only
 * caller that decides which root each layer gets. Neither file is required
 * to exist -- a missing or malformed file is treated as an empty config at
 * that layer, never an error, matching this repo's existing hooks-layer
 * config readers (hooks/lib/settings.mjs, hooks/lib/in-progress.mjs). */

export type ProjectOwnerType = 'organization' | 'user';

export interface BoardConfig {
  projectOwnerLogin?: string;
  projectNumber?: number;
  projectOwnerType?: ProjectOwnerType;
}

export interface GdlcConfig {
  targeting?: {
    allowRepos?: string[];
    allowOrgs?: string[];
  };
  destination?: {
    repo?: string;
  };
  board?: BoardConfig;
}

const CONFIG_RELPATH = ['gdlc', 'config.yml'] as const;

/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export function resolveConfigPath(root: string): string {
  return join(root, ...CONFIG_RELPATH);
}

export function resolveGlobalConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
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
 * reached. */
export function findProjectConfigRoot(startDir: string, existsFn: (path: string) => boolean = existsSync): string | null {
  let dir = resolvePath(startDir);
  for (;;) {
    if (existsFn(resolveConfigPath(join(dir, '.config')))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
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
function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => (typeof v === 'string' ? v : String(v)));
}

/** Normalize a parsed YAML document into a `GdlcConfig`, dropping anything
 * that doesn't match the schema (schema/gdlc-config.schema.json) rather than
 * throwing -- fail-soft, same convention as the hooks-layer readers. */
function normalizeConfig(parsed: unknown): GdlcConfig {
  if (!isPlainObject(parsed)) return {};
  const config: GdlcConfig = {};

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
    const board: BoardConfig = {};
    if (typeof projectOwnerLogin === 'string' && projectOwnerLogin !== '') board.projectOwnerLogin = projectOwnerLogin;
    // Accept a quoted numeric string ("4") as well as a bare YAML integer:
    // the hooks-layer reader (in-progress.mjs) can't distinguish YAML types
    // (it's a dependency-free regex parser, everything captured is text) and
    // always coerces via Number(); matching that here keeps the two
    // independent readers resolving the same file identically.
    if (typeof projectNumber === 'number' || typeof projectNumber === 'string') {
      const parsedNumber = Number(projectNumber);
      if (Number.isInteger(parsedNumber) && parsedNumber > 0) board.projectNumber = parsedNumber;
    }
    if (projectOwnerType === 'organization' || projectOwnerType === 'user') board.projectOwnerType = projectOwnerType;
    if (Object.keys(board).length > 0) config.board = board;
  }

  return config;
}

/** Read and parse one layer's `gdlc/config.yml`. A missing file, an
 * unreadable file, or a YAML syntax error are all an empty config, not a
 * thrown error -- a hooks-style fail-soft reader. Exported for tests. */
export function loadConfigFile(path: string): GdlcConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  try {
    return normalizeConfig(parse(text));
  } catch {
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
export function mergeConfigs(global: GdlcConfig, project: GdlcConfig): GdlcConfig {
  return { ...global, ...project };
}

/** Where the project layer's config file was found, for callers that want to
 * surface it as a diagnostic (issue #106: the prior silent cwd-mismatch gap
 * had no observable signal at all). `null` means no ancestor of `startDir`
 * had `.config/gdlc/config.yml` -- distinct from a found-but-empty file. */
export function resolveProjectConfigPath(
  startDir: string = process.cwd(),
  existsFn: (path: string) => boolean = existsSync,
): string | null {
  const root = findProjectConfigRoot(startDir, existsFn);
  return root === null ? null : resolveConfigPath(join(root, '.config'));
}

/** Load and merge both layers. `projectRoot` defaults to `process.cwd()`
 * (the running tool's project root); `env` defaults to `process.env` (for
 * `XDG_CONFIG_HOME`, tests inject a fake one). The project layer's file is
 * `<projectRoot>/.config/gdlc/config.yml` -- `resolveConfigPath` is given
 * `<projectRoot>/.config` as its root, not `projectRoot` itself, since
 * `$XDG_CONFIG_HOME` (the global root) already points at what `.config`
 * conceptually is for the global layer. Issue #106: `projectRoot` is only
 * the SEARCH START, not necessarily where the file is found -- `findProjectConfigRoot`
 * climbs upward from it first (see ADR-0005 for what this does and does not fix).
 * `existsFn` is injectable (default `existsSync`) so a test asserting "nothing
 * found anywhere" doesn't have to walk the real filesystem to its root, which
 * would risk a false match against whatever the test-running machine's real
 * ancestor directories happen to contain. */
export function loadGdlcConfig(
  projectRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  existsFn: (path: string) => boolean = existsSync,
): GdlcConfig {
  const global = loadConfigFile(resolveConfigPath(resolveGlobalConfigRoot(env)));
  const resolvedRoot = findProjectConfigRoot(projectRoot, existsFn);
  const project = resolvedRoot === null ? {} : loadConfigFile(resolveConfigPath(join(resolvedRoot, '.config')));
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
export function resolveBoardCoordinates(
  explicit: BoardConfig,
  config: GdlcConfig,
): { projectOwnerLogin: string; projectNumber: number; projectOwnerType?: ProjectOwnerType } | undefined {
  const hasExplicitLogin = explicit.projectOwnerLogin !== undefined;
  const hasExplicitNumber = explicit.projectNumber !== undefined;

  let projectOwnerLogin: string | undefined;
  let projectNumber: number | undefined;
  if (hasExplicitLogin && hasExplicitNumber) {
    projectOwnerLogin = explicit.projectOwnerLogin;
    projectNumber = explicit.projectNumber;
  } else if (!hasExplicitLogin && !hasExplicitNumber) {
    projectOwnerLogin = config.board?.projectOwnerLogin;
    projectNumber = config.board?.projectNumber;
  } else {
    return undefined;
  }
  if (projectOwnerLogin === undefined || projectNumber === undefined) return undefined;

  const projectOwnerType = explicit.projectOwnerType ?? config.board?.projectOwnerType;
  return { projectOwnerLogin, projectNumber, ...(projectOwnerType !== undefined && { projectOwnerType }) };
}

/** Split a configured `destination.repo` ("org/repo") into parts, or
 * `undefined` if unset or malformed. */
export function resolveDestinationRepo(config: GdlcConfig): { owner: string; repo: string } | undefined {
  const value = config.destination?.repo;
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  return { owner: parts[0], repo: parts[1] };
}

/** True when no `targeting` allowlist is configured at all (no
 * restriction), or when `owner/repo` matches `allowRepos` or `owner`
 * matches `allowOrgs`. */
export function isRepoAllowed(config: GdlcConfig, owner: string, repo: string): boolean {
  const targeting = config.targeting;
  if (!targeting) return true;
  const { allowRepos, allowOrgs } = targeting;
  const hasAnyAllowlist = (allowRepos && allowRepos.length > 0) || (allowOrgs && allowOrgs.length > 0);
  if (!hasAnyAllowlist) return true;
  if (allowRepos?.includes(`${owner}/${repo}`)) return true;
  if (allowOrgs?.includes(owner)) return true;
  return false;
}
