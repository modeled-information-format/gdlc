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
/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export declare function resolveConfigPath(root: string): string;
export declare function resolveGlobalConfigRoot(env?: NodeJS.ProcessEnv): string;
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
export declare function findProjectConfigRoot(startDir: string, existsFn?: (path: string) => boolean, ceiling?: string): string | null;
/** Read and parse one layer's `gdlc/config.yml`. A missing file, an
 * unreadable file, or a YAML syntax error are all an empty config, not a
 * thrown error -- a hooks-style fail-soft reader. Exported for tests. */
export declare function loadConfigFile(path: string): GdlcConfig;
/** Merge two layers **per top-level section**: a section present in
 * `project` replaces that section from `global` wholly (no leaf-key or
 * array merging) -- ADR-0004's "closer-to-project wins" direction, made
 * unambiguous for `allowRepos`/`allowOrgs` (issue #81's design). A plain
 * object spread implements this exactly, because `normalizeConfig` only
 * ever assigns a section key when it has a real value -- never `undefined`
 * -- so `project`'s own keys always take precedence and `global`'s show
 * through only where `project` has no key at all. */
export declare function mergeConfigs(global: GdlcConfig, project: GdlcConfig): GdlcConfig;
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
export declare function resolveProjectConfigPath(startDir?: string, existsFn?: (path: string) => boolean, env?: NodeJS.ProcessEnv): string | null;
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
export declare function loadGdlcConfig(projectRoot?: string, env?: NodeJS.ProcessEnv, existsFn?: (path: string) => boolean): GdlcConfig;
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
export declare function resolveBoardCoordinates(explicit: BoardConfig, config: GdlcConfig): {
    projectOwnerLogin: string;
    projectNumber: number;
    projectOwnerType?: ProjectOwnerType;
} | undefined;
/** Split a configured `destination.repo` ("org/repo") into parts, or
 * `undefined` if unset or malformed. */
export declare function resolveDestinationRepo(config: GdlcConfig): {
    owner: string;
    repo: string;
} | undefined;
/** True when no `targeting` allowlist is configured at all (no
 * restriction), or when `owner/repo` matches `allowRepos` or `owner`
 * matches `allowOrgs`. */
export declare function isRepoAllowed(config: GdlcConfig, owner: string, repo: string): boolean;
