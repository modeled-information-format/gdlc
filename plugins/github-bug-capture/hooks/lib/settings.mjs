/**
 * Pack-toggle reader — the enhancement-pack control plane (issue #47,
 * migrated off markdown by ADR-0006).
 *
 * Reads the `packs:` section of `.config/gdlc/config.yml` (project layer,
 * then global layer) and answers "is this pack enabled?". Deliberately
 * dependency-free: this hook can't import `@github-sdlc-plugins/
 * github-sdlc-planning-mcp-server`'s `config.ts` (no `node_modules` at
 * hook-execution time), so it re-implements the same minimal YAML-subset
 * parsing and layer-resolution logic `github-sdlc-planning`'s
 * `hooks/lib/in-progress.mjs` already proved out for its `board:` section
 * — deliberately not shared code, same convention that module documents.
 *
 * Fail-closed by design: missing file, missing `packs:` section, missing
 * key, or a non-`true` value all mean DISABLED. The Layer 1 core never
 * consults this file.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';

export const KNOWN_PACKS = ['hooks', 'triage-skills', 'mcp-integration', 'gh-aw'];

const GDLC_CONFIG_RELPATH = join('gdlc', 'config.yml');

/** Same relative suffix as the mcp-server's config.ts (ADR-0004/0006). */
function resolveGdlcConfigPath(root) {
  return join(root, GDLC_CONFIG_RELPATH);
}

function resolveGlobalGdlcConfigRoot(env = process.env) {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}

/** ADR-0008: the ancestor-directory sequence `findAllGdlcProjectConfigPaths`
 * walks. Yields `startDir` itself first, then each ancestor toward
 * `ceiling` (exclusive), nearest first. Was shared with a single-match
 * `findGdlcProjectRoot` (ADR-0005) before ADR-0008 replaced every call site
 * of that function in this file with the multi-match version below; kept as
 * its own named generator rather than inlined, matching the shared-walk
 * shape `in-progress.mjs`/`config.ts` also use, in case a future
 * single-match need reappears. */
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
 * collision. Existence-only: never reads file content, so callers (see
 * `readPacksConfig` below) control exactly when/how each candidate is
 * actually parsed, using the real `resolveLayerPacks` presence check --
 * not a separate synthetic predicate. Exported for tests. */
export function findAllGdlcProjectConfigPaths(startDir, existsFn = existsSync, env = process.env, ceiling = homedir()) {
  const globalPath = resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env));
  const paths = [];
  for (const dir of walkGdlcAncestorDirs(startDir, ceiling)) {
    const candidate = resolveGdlcConfigPath(join(dir, '.config'));
    if (existsFn(candidate) && candidate !== globalPath) paths.push(candidate);
  }
  return paths;
}

/** Extract a scalar value from the text captured after `key:`, same
 * quote/comment handling as `in-progress.mjs`'s `extractScalarValue`. */
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

/** Parse a top-level `packs:` map out of a plain-YAML `gdlc/config.yml`
 * document (no frontmatter delimiters, unlike the retired markdown
 * carrier). Same constrained 2-space-indent scalar-map parsing as
 * `in-progress.mjs`'s `parseGdlcBoardSection`, generalized to arbitrary
 * pack-name keys and boolean-only values instead of a fixed board shape.
 * Malformed or non-boolean entries are dropped, not thrown -- fail-closed,
 * matching the rest of this reader. Exported for tests. */
export function parsePacksSection(text) {
  const lines = String(text).split(/\r?\n/);
  let inPacks = false;
  const packs = {};
  for (const line of lines) {
    if (/^packs:\s*$/.test(line)) {
      inPacks = true;
      continue;
    }
    if (inPacks) {
      const m = /^ {2}([a-z][a-z0-9-]*):\s*(.+?)\s*$/.exec(line);
      if (m) {
        const value = extractScalarValue(m[2]);
        if (value === 'true' || value === 'false') packs[m[1]] = value === 'true';
        continue;
      }
      if (/^ {2}\S/.test(line)) continue;
      inPacks = false;
    }
  }
  return packs;
}

/** Read one layer's `gdlc/config.yml` and report both whether it actually
 * defines any usable `packs:` entry and, if so, its parsed map -- mirroring
 * `in-progress.mjs`'s `resolveGdlcLayerBoard`, so a present-but-different
 * project section can wholly replace the global one instead of falling
 * through to it.
 *
 * ADR-0008 bug fix: present is `Object.keys(packs).length > 0`, NOT merely
 * whether the `packs:` header line exists (e.g. a comment-only body used to
 * count as present here, with an empty map) -- the same presence-semantics
 * bug `pr-lifecycle-config.mjs`'s `resolveLayerPrLifecycle` was already
 * fixed for once, caught here by a regression test for ADR-0008's
 * ancestor-shadowing fix. */
function resolveLayerPacks(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: false, packs: {} };
  }
  const packs = parsePacksSection(text);
  return Object.keys(packs).length > 0 ? { present: true, packs } : { present: false, packs: {} };
}

/** Resolve the merged `packs:` map: the NEAREST ancestor layer whose
 * `packs:` section is actually present (ADR-0004's per-section cascade,
 * ADR-0008's N-ancestor extension) replaces the global one wholly -- it
 * does not fall through to the global layer just because a NEARER
 * ancestor's file doesn't happen to define `packs:` at all, only once NO
 * ancestor does. Exported for tests. */
export function readPacksConfig(cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  for (const path of findAllGdlcProjectConfigPaths(cwd, existsFn, env)) {
    const layer = resolveLayerPacks(path);
    if (layer.present) return layer.packs;
  }

  const global = resolveLayerPacks(resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)));
  return global.packs;
}

/** True only when the merged `packs:` config explicitly sets the pack to
 * `true`. Fail-closed: a missing file, a missing `packs:` section, a
 * missing key, or a non-`true` value all mean disabled. `env`/`existsFn`
 * are optional trailing params (default `process.env`/`existsSync`, same
 * pattern as `in-progress.mjs`'s `readBoardConfig`) so tests can inject a
 * hermetic environment without a real filesystem climb toward `homedir()`;
 * every production call site only ever passes `(pack, projectDir)`. */
export function isPackEnabled(pack, projectDir = process.cwd(), env = process.env, existsFn = existsSync) {
  return readPacksConfig(projectDir, env, existsFn)[pack] === true;
}
