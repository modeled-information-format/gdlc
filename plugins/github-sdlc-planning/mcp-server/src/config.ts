import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { parse } from 'yaml';
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
  /** gdlc#275: whether `requireLocalReview`'s reminder actually blocks
   * (`permissionDecision: 'ask'`) or merely surfaces as non-blocking context
   * (`permissionDecision: 'allow'` with the same `permissionDecisionReason`).
   * Defaults to `false` -- mirrors `skipMutationConfirm`'s opt-out shape:
   * every repo that has never heard of this key keeps the check running,
   * just without the hard stop. Has no effect unless `requireLocalReview`
   * is itself enabled. */
  confirmLocalReview?: boolean;
  /** gdlc#275: same opt-out, for `gateNewWorkOnUnresolvedThreads`'s gate.
   * Defaults to `false`. Has no effect unless `gateNewWorkOnUnresolvedThreads`
   * is itself enabled. */
  confirmNewWorkGate?: boolean;
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
   * github-bug-capture; `skipMutationConfirm` for github-sdlc-planning;
   * `monitors` for ADR-0010's session monitors across all three
   * hook-bearing plugins). Supersedes the legacy `packs:` map in
   * `.claude/github-bug-capture.local.md`. */
  packs?: Record<string, boolean>;
  prLifecycle?: PrLifecycleConfig;
}

const CONFIG_RELPATH = ['gdlc', 'config.yml'] as const;

/** Same relative suffix under either root -- the one path rule both layers
 * share (ADR-0004's primary decision driver #2). */
export function resolveConfigPath(root: string): string {
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
export function findProjectConfigRoot(
  startDir: string,
  existsFn: (path: string) => boolean = existsSync,
  ceiling: string = homedir(),
): string | null {
  for (const dir of walkAncestorDirs(startDir, ceiling)) {
    if (existsFn(resolveConfigPath(join(dir, '.config')))) return dir;
  }
  return null;
}

/** ADR-0008: the ancestor-directory sequence both `findProjectConfigRoot`
 * (single nearest match) and `findAllProjectConfigPaths` (every match) walk
 * -- one generator, so a correctness fix to the walk itself (ceiling
 * handling, filesystem-root termination) only has one place to land instead
 * of two copies that must be kept in sync by hand. Yields `startDir` itself
 * first, then each ancestor toward `ceiling` (exclusive), nearest first.
 * Exported so `get_gdlc_config` (tools/config.ts) can report every ancestor
 * it checked -- not just the ones with a file -- without a second,
 * divergent walk implementation (Copilot review finding on PR #269: the
 * original `getGdlcConfig` only surfaced existing project layers via
 * `findAllProjectConfigPaths`'s own existence filter, silently omitting
 * checked-but-absent candidates its own description claimed to report). */
export function* walkAncestorDirs(startDir: string, ceiling: string): Generator<string> {
  const ceilingResolved = resolvePath(ceiling);
  let dir = resolvePath(startDir);
  for (;;) {
    if (dir === ceilingResolved) return;
    yield dir;
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

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
export function findAllProjectConfigPaths(
  startDir: string = process.cwd(),
  existsFn: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env,
  ceiling: string = homedir(),
): string[] {
  const globalPath = resolveConfigPath(resolveGlobalConfigRoot(env));
  const paths: string[] = [];
  for (const dir of walkAncestorDirs(startDir, ceiling)) {
    const candidate = resolveConfigPath(join(dir, '.config'));
    if (existsFn(candidate) && candidate !== globalPath) paths.push(candidate);
  }
  return paths;
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

  // ADR-0008 / Copilot review finding on PR #238: `board:`'s presence rule
  // is deliberately narrower than `packs:`/`prLifecycle:`'s (see that ADR's
  // Cascade section) -- the hooks-layer reader (`parseGdlcBoardSection`)
  // treats the bare `board:` HEADER LINE existing as "present", regardless
  // of whether any child field validates, so a present-but-invalid section
  // stops the cascade there rather than falling through to a further
  // ancestor or the global layer. The original `isPlainObject(parsed.board)`
  // gate here, combined with only setting `config.board` when
  // `Object.keys(board).length > 0`, instead treated a `board:` section
  // with zero *valid* fields (comment-only body, or every key malformed) as
  // absent -- silently falling through and diverging from the hooks-layer
  // reader for the exact same file. `parsed.board === null` (a bare
  // `board:` key, or one followed only by a stripped comment) also counts
  // as the header being present, matching the hooks regex's `board:\s*$`
  // match regardless of what (if anything) follows on subsequent lines. An
  // inline scalar (`board: "not-a-map"`) or array value does NOT count --
  // the hooks regex only recognizes the `key:` header form implying a
  // nested block, not an inline assignment on the same line, so this stays
  // absent on both sides. */
  if (parsed.board === null || isPlainObject(parsed.board)) {
    const raw = isPlainObject(parsed.board) ? parsed.board : {};
    const { projectOwnerLogin, projectNumber, projectOwnerType } = raw;
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
    config.board = board;
  }

  if (isPlainObject(parsed.packs)) {
    const packs: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed.packs)) {
      if (typeof value === 'boolean') packs[key] = value;
    }
    if (Object.keys(packs).length > 0) config.packs = packs;
  }

  if (isPlainObject(parsed.prLifecycle)) {
    const raw = parsed.prLifecycle;
    const prLifecycle: PrLifecycleConfig = {};
    if (typeof raw.enabled === 'boolean') prLifecycle.enabled = raw.enabled;
    // Copilot review finding: trim before validating, matching the
    // hooks-layer reader's extractScalarValue().trim() -- otherwise
    // localReviewer: "   " is accepted here (present, non-empty) but
    // dropped by the hooks reader (trims to '', treated as absent), the two
    // independent readers silently disagreeing about the same file.
    if (typeof raw.localReviewer === 'string' && raw.localReviewer.trim() !== '') prLifecycle.localReviewer = raw.localReviewer.trim();
    if (typeof raw.requireLocalReview === 'boolean') prLifecycle.requireLocalReview = raw.requireLocalReview;
    if (typeof raw.requireCopilotReview === 'boolean') prLifecycle.requireCopilotReview = raw.requireCopilotReview;
    if (typeof raw.requireCleanCodeScanning === 'boolean') prLifecycle.requireCleanCodeScanning = raw.requireCleanCodeScanning;
    if (typeof raw.gateNewWorkOnUnresolvedThreads === 'boolean') prLifecycle.gateNewWorkOnUnresolvedThreads = raw.gateNewWorkOnUnresolvedThreads;
    if (typeof raw.confirmLocalReview === 'boolean') prLifecycle.confirmLocalReview = raw.confirmLocalReview;
    if (typeof raw.confirmNewWorkGate === 'boolean') prLifecycle.confirmNewWorkGate = raw.confirmNewWorkGate;
    if (Object.keys(prLifecycle).length > 0) config.prLifecycle = prLifecycle;
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
export function resolveProjectConfigPath(
  startDir: string = process.cwd(),
  existsFn: (path: string) => boolean = existsSync,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const root = findProjectConfigRoot(startDir, existsFn);
  if (root === null) return null;
  const path = resolveConfigPath(join(root, '.config'));
  return path === resolveConfigPath(resolveGlobalConfigRoot(env)) ? null : path;
}

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
export function loadGdlcConfig(
  projectRoot: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
  existsFn: (path: string) => boolean = existsSync,
): GdlcConfig {
  const global = loadConfigFile(resolveConfigPath(resolveGlobalConfigRoot(env)));
  const projectPaths = findAllProjectConfigPaths(projectRoot, existsFn, env);
  // Furthest-first, so a nearer ancestor's mergeConfigs call runs last and
  // wins per-section over both the global layer and every further ancestor.
  return projectPaths.reduceRight((acc, path) => mergeConfigs(acc, loadConfigFile(path)), global);
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

/** Fail-closed by design (ADR-0006): a missing `packs` section, a missing
 * key, or a non-`true` value all mean disabled. Matches the fail-closed
 * contract `github-bug-capture`'s hooks-layer reader implements
 * independently (dependency-free, so it can't import this module). */
export function isPackEnabled(config: GdlcConfig, pack: string): boolean {
  return config.packs?.[pack] === true;
}

export interface ResolvedPrLifecycleConfig {
  enabled: boolean;
  localReviewer: string;
  requireLocalReview: boolean;
  requireCopilotReview: boolean;
  requireCleanCodeScanning: boolean;
  gateNewWorkOnUnresolvedThreads: boolean;
  confirmLocalReview: boolean;
  confirmNewWorkGate: boolean;
}

const DEFAULT_LOCAL_REVIEWER = '/code-review --fix';

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
 * consuming hook and its own doc comment on this same constraint.
 *
 * `confirmLocalReview`/`confirmNewWorkGate` (gdlc#275) each default to
 * `false`: the reminder still fires whenever `requireLocalReview`/
 * `gateNewWorkOnUnresolvedThreads` is on, but as a non-blocking
 * `permissionDecision: 'allow'` (context only) rather than a hard `'ask'`
 * stop. Setting either to `true` restores the original hard-stop behavior.
 * Same opt-out shape as `skipMutationConfirm` (issue #183): before this,
 * the only way to silence the blocking prompt was to disable the whole
 * check, reminder included. */
export function resolvePrLifecycleConfig(config: GdlcConfig): ResolvedPrLifecycleConfig {
  const raw = config.prLifecycle ?? {};
  return {
    enabled: raw.enabled === true,
    localReviewer: raw.localReviewer ?? DEFAULT_LOCAL_REVIEWER,
    requireLocalReview: raw.requireLocalReview ?? true,
    requireCopilotReview: raw.requireCopilotReview ?? true,
    requireCleanCodeScanning: raw.requireCleanCodeScanning ?? true,
    gateNewWorkOnUnresolvedThreads: raw.gateNewWorkOnUnresolvedThreads ?? true,
    confirmLocalReview: raw.confirmLocalReview ?? false,
    confirmNewWorkGate: raw.confirmNewWorkGate ?? false,
  };
}
