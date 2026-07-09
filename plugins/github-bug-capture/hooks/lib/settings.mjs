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

/** ADR-0005's upward search, re-implemented here for the same
 * dependency-free reason as `in-progress.mjs`'s identical function. Climbs
 * from `startDir` toward the filesystem root looking for
 * `<dir>/.config/gdlc/config.yml`; `ceiling` (default `homedir()`) stops the
 * climb before checking that directory, so a stray leftover file at the
 * OS-default global-layer path is never mistaken for a project config. */
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

/** Same collision guard as `in-progress.mjs`'s identical function: excludes
 * a project-layer "find" that is literally the global layer's own file. */
function resolveGdlcProjectConfigPath(startDir, existsFn, env) {
  const root = findGdlcProjectRoot(startDir, existsFn);
  if (root === null) return null;
  const path = resolveGdlcConfigPath(join(root, '.config'));
  return path === resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env)) ? null : path;
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

/** Read one layer's `gdlc/config.yml` and report both whether a `packs:`
 * key exists at all and, if so, its parsed map -- mirroring
 * `in-progress.mjs`'s `resolveGdlcLayerBoard`, so a present-but-different
 * project section can wholly replace the global one instead of falling
 * through to it. */
function resolveLayerPacks(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { present: false, packs: {} };
  }
  if (!/^packs:\s*$/m.test(text)) return { present: false, packs: {} };
  return { present: true, packs: parsePacksSection(text) };
}

/** Resolve the merged `packs:` map: a `packs:` section present at the
 * project layer replaces the global one wholly (ADR-0004's per-section
 * cascade, same semantics as `config.ts`'s `mergeConfigs` for every other
 * section) -- it does not fall through to the global layer just because
 * the project layer's map doesn't happen to name every pack. Exported for
 * tests. */
export function readPacksConfig(cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  const projectPath = resolveGdlcProjectConfigPath(cwd, existsFn, env);
  const project = projectPath === null ? { present: false, packs: {} } : resolveLayerPacks(projectPath);
  if (project.present) return project.packs;

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
