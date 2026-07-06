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
/** Load and merge both layers. `projectRoot` defaults to `process.cwd()`
 * (the running tool's project root); `env` defaults to `process.env` (for
 * `XDG_CONFIG_HOME`, tests inject a fake one). The project layer's file is
 * `<projectRoot>/.config/gdlc/config.yml` -- `resolveConfigPath` is given
 * `<projectRoot>/.config` as its root, not `projectRoot` itself, since
 * `$XDG_CONFIG_HOME` (the global root) already points at what `.config`
 * conceptually is for the global layer. */
export declare function loadGdlcConfig(projectRoot?: string, env?: NodeJS.ProcessEnv): GdlcConfig;
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
