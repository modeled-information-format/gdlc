import { resolveGlobalConfigRoot } from './xdg.js';
export { resolveGlobalConfigRoot };
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
/** Issue #185/#186: PR-lifecycle enforcement opt-in, section-cascaded the
 * same as `board`/`packs`. Every field is optional at the config layer --
 * `resolvePrLifecycleConfig` is where defaults get applied, not here, so
 * `normalizeConfig` stays a pure "what did the file actually say" reader. */
export interface PrLifecycleConfig {
    enabled?: boolean;
    /** Command template shown to the agent as the local-review gate, e.g.
     * `/code-review --fix`. Never executed by a hook -- see
     * `resolvePrLifecycleConfig`'s doc comment for why. */
    localReviewer?: string;
    requireLocalReview?: boolean;
    requireCopilotReview?: boolean;
    requireCleanCodeScanning?: boolean;
    /** gdlc#202/#211: gate starting new branch/worktree work on any PR opened
     * this session still having unresolved review threads. */
    gateNewWorkOnUnresolvedThreads?: boolean;
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
    /** Enhancement-pack opt-in toggles (ADR-0006), keyed by pack name
     * (e.g. `hooks`, `triage-skills`, `mcp-integration`, `gh-aw` for
     * github-bug-capture today). Supersedes the legacy `packs:` map in
     * `.claude/github-bug-capture.local.md`. */
    packs?: Record<string, boolean>;
    prLifecycle?: PrLifecycleConfig;
}
/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export declare function resolveConfigPath(root: string): string;
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
/** ADR-0008: every ancestor of `startDir` (up to `ceiling`, exclusive)
 * whose `.config/gdlc/config.yml` exists, nearest first, EXCLUDING (but not
 * stopping the climb at) a candidate that collides with the global layer's
 * own resolved path -- same collision guard as `resolveProjectConfigPath`,
 * but skip-and-continue instead of stop-and-return-null, so a legitimate
 * further ancestor is never hidden behind an accidental collision.
 *
 * `findProjectConfigRoot` only ever surfaces the single NEAREST such
 * directory -- correct for the `projectConfigPath` diagnostic (naming one
 * concrete file), but wrong for `loadGdlcConfig`'s merge: a nearer ancestor
 * whose file defines only one section (e.g. `board:`) would otherwise make
 * `findProjectConfigRoot` stop there, silently hiding a `packs:`/
 * `prLifecycle:` section set at any further ancestor and falling straight
 * through to the *global* layer instead -- the exact bug #227 reported.
 * Exported for tests. */
export declare function findAllProjectConfigPaths(startDir?: string, existsFn?: (path: string) => boolean, env?: NodeJS.ProcessEnv, ceiling?: string): string[];
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
/** Load and merge every layer. `projectRoot` defaults to `process.cwd()`
 * (the running tool's project root); `env` defaults to `process.env` (for
 * `XDG_CONFIG_HOME`, tests inject a fake one).
 *
 * ADR-0008: merges EVERY ancestor project-layer file found by
 * `findAllProjectConfigPaths`, nearest-wins per section, onto the global
 * layer as the base -- not just the single nearest one (issue #106 /
 * ADR-0005's original design). A nearer ancestor's file replaces a further
 * ancestor's (or global's) same section wholly (ADR-0004's per-section
 * cascade, now extended across N ancestor layers instead of just one),
 * while a section that nearer file doesn't define falls through to the
 * next ancestor that does, and only then to global. `existsFn` is
 * injectable (default `existsSync`) so a test asserting "nothing found
 * anywhere" doesn't have to walk the real filesystem to its root, which
 * would risk a false match against whatever the test-running machine's
 * real ancestor directories happen to contain. */
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
/** Fail-closed by design (ADR-0006): a missing `packs` section, a missing
 * key, or a non-`true` value all mean disabled. Matches the fail-closed
 * contract `github-bug-capture`'s hooks-layer reader implements
 * independently (dependency-free, so it can't import this module). */
export declare function isPackEnabled(config: GdlcConfig, pack: string): boolean;
export interface ResolvedPrLifecycleConfig {
    enabled: boolean;
    localReviewer: string;
    requireLocalReview: boolean;
    requireCopilotReview: boolean;
    requireCleanCodeScanning: boolean;
    gateNewWorkOnUnresolvedThreads: boolean;
}
/** Applies defaults to the raw `prLifecycle` section (issue #185/#186).
 * `enabled` defaults to `false` -- an absent or malformed section means the
 * feature is off, matching every other opt-in surface in this codebase
 * (`packs`, `skipMutationConfirm`): a repo that has never heard of this
 * feature does not suddenly get new hook prompts. Once `enabled: true`, the
 * three `require*` sub-toggles each default to `true` (enforce everything)
 * and `localReviewer` defaults to `/code-review --fix` -- Claude Code's own
 * native, current-diff-based review command, which can run before a PR
 * exists. This is NOT the same as the plugin-qualified
 * `/code-review:code-review`, which resolves to the separate
 * `code-review@claude-plugins-official` marketplace plugin: that command is
 * PR-fetch-only (`gh pr diff`/`gh pr view`) and has no `--fix` handling, so
 * it cannot satisfy this pre-PR gate at all -- opting in without naming
 * every field gets the strictest sane behavior, not a silently-unsatisfiable
 * one.
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
export declare function resolvePrLifecycleConfig(config: GdlcConfig): ResolvedPrLifecycleConfig;
