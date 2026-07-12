/**
 * Dependency-free `prLifecycle:` reader for this plugin's own hooks (issue
 * #185/#187). Hooks run with bare node, no node_modules at hook-execution
 * time, so this can't import the mcp-server's config.ts (which already
 * defines the same `prLifecycle` shape and merge semantics, consumed by
 * this plugin's own MCP tools via the existing `file:` dependency -- see
 * docs/reference/config-schema.md's "Where the loader lives"). This file
 * re-implements just the path-resolution/upward-search plumbing and the
 * `prLifecycle:` scalar-map parsing, the same way `github-sdlc-planning`'s
 * `hooks/lib/in-progress.mjs` (`board:`) and `hooks/lib/settings.mjs`
 * (`packs:`) each do independently, on purpose -- these readers are
 * deliberately NOT shared across a plugin boundary (see
 * `mcp-tool-name.mjs`'s doc comment in that plugin for the rationale).
 *
 * Fail-closed by design: missing file, missing `prLifecycle:` section,
 * missing key, or a malformed value all resolve to the safest default
 * (`enabled: false`, i.e. this plugin's PR-lifecycle hooks stay no-ops),
 * mirroring `resolvePrLifecycleConfig`'s defaults in config.ts exactly so
 * the two independent readers can never disagree about what "enabled"
 * means.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';

const GDLC_CONFIG_RELPATH = join('gdlc', 'config.yml');
// Claude Code's native, current-diff-based review command (can run before a
// PR exists) -- NOT `/code-review:code-review`, which is the plugin-qualified
// name of the separate `code-review@claude-plugins-official` marketplace
// plugin: that command is PR-fetch-only and has no `--fix` handling, so it
// cannot satisfy this pre-PR gate. Kept in sync by hand with config.ts's
// identical constant -- see that file's doc comment for the full rationale.
const DEFAULT_LOCAL_REVIEWER = '/code-review --fix';

function resolveGdlcConfigPath(root) {
  return join(root, GDLC_CONFIG_RELPATH);
}

function resolveGlobalGdlcConfigRoot(env = process.env) {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}

/** ADR-0008: the ancestor-directory sequence `findAllGdlcProjectConfigPaths`
 * walks. Yields `startDir` itself first, then each ancestor toward
 * `ceiling` (exclusive), nearest first. */
function* walkGdlcAncestorDirs(startDir, ceiling) {
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
 * own resolved path -- skip-and-continue instead of stop-and-return-null,
 * so a legitimate further ancestor is never hidden behind an accidental
 * collision. Existence-only: never reads file content, so
 * `readPrLifecycleRaw` below controls exactly when/how each candidate is
 * actually parsed, using the real `resolveLayerPrLifecycle` presence check
 * -- not a separate synthetic predicate. Same upward search as
 * `in-progress.mjs`'s `findAllGdlcProjectConfigPaths` and `settings.mjs`'s
 * identical function in the sibling plugins. Exported for tests. */
export function findAllGdlcProjectConfigPaths(startDir, existsFn = existsSync, env = process.env, ceiling = homedir()) {
  const globalPath = resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env));
  const paths = [];
  for (const dir of walkGdlcAncestorDirs(startDir, ceiling)) {
    const candidate = resolveGdlcConfigPath(join(dir, '.config'));
    if (existsFn(candidate) && candidate !== globalPath) paths.push(candidate);
  }
  return paths;
}

/** Same quote/comment handling as `in-progress.mjs`'s `extractScalarValue`. */
function extractScalarValue(raw) {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    const closingIndex = trimmed.indexOf(quote, 1);
    return closingIndex === -1 ? trimmed.slice(1) : trimmed.slice(1, closingIndex);
  }
  const commentIndex = trimmed.search(/\s#/);
  return (commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex)).trim();
}

const BOOLEAN_KEYS = new Set(['enabled', 'requireLocalReview', 'requireCopilotReview', 'requireCleanCodeScanning', 'gateNewWorkOnUnresolvedThreads']);

/** Parse a top-level `prLifecycle:` scalar map out of a plain-YAML
 * `gdlc/config.yml` document, same constrained 2-space-indent shape as
 * `parseGdlcBoardSection`. `enabled`/`require*` coerce to boolean only from
 * literal `true`/`false` (fail-closed on anything else, same as every other
 * boolean this codebase's dependency-free readers parse); `localReviewer`
 * is kept as a raw string. Exported for tests. */
export function parsePrLifecycleSection(text) {
  const lines = String(text).split(/\r?\n/);
  let inSection = false;
  let found = false;
  const raw = {};
  for (const line of lines) {
    if (/^prLifecycle:\s*$/.test(line)) {
      inSection = true;
      found = true;
      continue;
    }
    if (inSection) {
      const m = /^ {2}([a-zA-Z][a-zA-Z0-9]*):\s*(.+?)\s*$/.exec(line);
      if (m) {
        const value = extractScalarValue(m[2]);
        if (BOOLEAN_KEYS.has(m[1])) {
          if (value === 'true' || value === 'false') raw[m[1]] = value === 'true';
        } else if (m[1] === 'localReviewer') {
          // Copilot review finding: trim before storing, matching
          // config.ts's normalizeConfig -- a quoted whitespace-only value
          // (`localReviewer: "   "`) must fail closed the same way here as
          // it does there, not be kept as a literal blank-looking command.
          const trimmedValue = value.trim();
          if (trimmedValue !== '') raw.localReviewer = trimmedValue;
        }
        continue;
      }
      if (/^ {2}\S/.test(line)) continue;
      inSection = false;
    }
  }
  return { found, raw };
}

function resolveLayerPrLifecycle(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: false, raw: {} };
  }
  const { raw } = parsePrLifecycleSection(text);
  // Present only when at least one key actually parsed -- NOT merely
  // whether the `prLifecycle:` header line existed (review-caught bug: an
  // earlier revision used `found`, so a project layer with a `prLifecycle:`
  // header but every child key malformed would short-circuit the cascade
  // with an empty raw config instead of falling through to the global
  // layer). This must match config.ts's `normalizeConfig`, where a section
  // with zero successfully-parsed keys is omitted from that layer's config
  // entirely -- otherwise the hook and the MCP tool layer can disagree
  // about whether `prLifecycle` is enabled for the exact same file. */
  return Object.keys(raw).length > 0 ? { present: true, raw } : { present: false, raw: {} };
}

/** The NEAREST ancestor layer whose `prLifecycle:` section is actually
 * present (ADR-0004's per-section cascade, ADR-0008's N-ancestor extension)
 * replaces the global one wholly -- it does not fall through to the global
 * layer just because a NEARER ancestor's file doesn't happen to define
 * `prLifecycle:` at all (or defines it with zero valid keys), only once NO
 * ancestor does. Exported for tests. */
export function readPrLifecycleRaw(cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  for (const path of findAllGdlcProjectConfigPaths(cwd, existsFn, env)) {
    const layer = resolveLayerPrLifecycle(path);
    if (layer.present) return layer.raw;
  }

  const global = resolveLayerPrLifecycle(resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)));
  return global.raw;
}

/** Applies the identical defaults `resolvePrLifecycleConfig` (config.ts)
 * applies -- kept in sync by hand, the same way the two independent
 * `board:` readers are kept behaviorally identical on purpose (issue #83).
 * `enabled` defaults `false`: an absent or malformed section means this
 * plugin's PR-lifecycle hooks stay no-ops. */
export function resolvePrLifecycle(cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  const raw = readPrLifecycleRaw(cwd, env, existsFn);
  return {
    enabled: raw.enabled === true,
    localReviewer: raw.localReviewer ?? DEFAULT_LOCAL_REVIEWER,
    requireLocalReview: raw.requireLocalReview ?? true,
    requireCopilotReview: raw.requireCopilotReview ?? true,
    requireCleanCodeScanning: raw.requireCleanCodeScanning ?? true,
    gateNewWorkOnUnresolvedThreads: raw.gateNewWorkOnUnresolvedThreads ?? true,
  };
}
