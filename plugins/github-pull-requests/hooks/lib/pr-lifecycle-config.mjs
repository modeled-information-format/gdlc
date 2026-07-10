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
const DEFAULT_LOCAL_REVIEWER = '/code-review:code-review --fix';

function resolveGdlcConfigPath(root) {
  return join(root, GDLC_CONFIG_RELPATH);
}

function resolveGlobalGdlcConfigRoot(env = process.env) {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}

/** Same upward search as `in-progress.mjs`'s `findGdlcProjectRoot` and
 * `settings.mjs`'s identical function in the sibling plugins. */
function findGdlcProjectRoot(startDir, existsFn = existsSync, ceiling = homedir()) {
  const ceilingResolved = resolvePath(ceiling);
  let dir = resolvePath(startDir);
  for (;;) {
    if (dir === ceilingResolved) return null;
    if (existsFn(resolveGdlcConfigPath(join(dir, '.config')))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveGdlcProjectConfigPath(startDir, existsFn, env) {
  const root = findGdlcProjectRoot(startDir, existsFn);
  if (root === null) return null;
  const path = resolveGdlcConfigPath(join(root, '.config'));
  return path === resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)) ? null : path;
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

const BOOLEAN_KEYS = new Set(['enabled', 'requireLocalReview', 'requireCopilotReview', 'requireCleanCodeScanning']);

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

/** Project layer replaces global wholly when present (ADR-0004's
 * per-section cascade), same as every other section. Exported for tests. */
export function readPrLifecycleRaw(cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  const projectPath = resolveGdlcProjectConfigPath(cwd, existsFn, env);
  const project = projectPath === null ? { present: false, raw: {} } : resolveLayerPrLifecycle(projectPath);
  if (project.present) return project.raw;

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
  };
}
