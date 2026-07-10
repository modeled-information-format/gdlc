/**
 * Pack-toggle reader for github-sdlc-planning's own hooks (issue #183:
 * confirm-mutation.mjs's PreToolUse `ask` has no opt-out, and Claude Code's
 * permission precedence is deny > ask > allow evaluated across every
 * source -- a hook-returned `ask` always wins over a `permissions.allow`
 * entry or a persisted "don't ask again" grant, so no amount of settings.json
 * allow-listing can silence it).
 *
 * Reads the `packs:` section of `.config/gdlc/config.yml` (project layer,
 * then global layer) and answers "is this pack enabled?". Deliberately
 * dependency-free, same reason as github-bug-capture's own separate
 * hooks/lib/settings.mjs: hooks run with bare node, no node_modules at
 * hook-execution time, so this can't import the mcp-server's config.ts
 * (which already defines the same `packs:` shape and merge semantics --
 * this file re-implements just the packs slice of it). The path-resolution
 * and upward-search plumbing is NOT re-implemented a second time here,
 * though: it's imported from this same plugin's `in-progress.mjs`, which
 * already proved it out for the `board:` section (see that module's doc
 * comment for why the two files share this one implementation within the
 * plugin, unlike the intentionally-separate cross-plugin copy).
 *
 * Fail-closed by design: missing file, missing `packs:` section, missing
 * key, or a non-`true` value all mean DISABLED -- every pack here defaults
 * to the safest behavior (confirm-mutation.mjs still asks) unless explicitly
 * opted into.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  extractScalarValue,
  resolveGdlcConfigPath,
  resolveGdlcProjectConfigPath,
  resolveGlobalGdlcConfigRoot,
} from './in-progress.mjs';

/** Only pack this plugin currently defines. `schema/gdlc-config.schema.json`'s
 * `packs:` map is deliberately open (`additionalProperties: {type: boolean}`)
 * so a new pack name here needs no schema change. */
export const KNOWN_PACKS = ['skipMutationConfirm'];

/** Parse a top-level `packs:` map out of a plain-YAML `gdlc/config.yml`
 * document in one pass, reporting both whether a `packs:` key exists at all
 * and, if so, its parsed map -- same single-pass shape as `in-progress.mjs`'s
 * `parseGdlcBoardSection`/`found` flag, so callers don't need a separate
 * whole-file regex scan just to learn presence (a second full-text scan
 * this file's earlier revision made unnecessarily, on confirm-mutation.mjs's
 * hot path -- every mutating tool call). Same constrained 2-space-indent
 * scalar-map parsing as `parseGdlcBoardSection`, generalized to arbitrary
 * pack-name keys and boolean-only values instead of a fixed board shape.
 * Malformed or non-boolean entries are dropped, not thrown -- fail-closed,
 * matching the rest of this reader. Exported for tests. */
export function parsePacksSection(text) {
  const lines = String(text).split(/\r?\n/);
  let inPacks = false;
  let found = false;
  const packs = {};
  for (const line of lines) {
    if (/^packs:\s*$/.test(line)) {
      inPacks = true;
      found = true;
      continue;
    }
    if (inPacks) {
      const m = /^ {2}([a-zA-Z][a-zA-Z0-9-]*):\s*(.+?)\s*$/.exec(line);
      if (m) {
        const value = extractScalarValue(m[2]);
        if (value === 'true' || value === 'false') packs[m[1]] = value === 'true';
        continue;
      }
      if (/^ {2}\S/.test(line)) continue;
      inPacks = false;
    }
  }
  return { found, packs };
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
  const { found, packs } = parsePacksSection(text);
  return found ? { present: true, packs } : { present: false, packs: {} };
}

/** Resolve the merged `packs:` map: a `packs:` section present at the
 * project layer replaces the global one wholly (ADR-0004's per-section
 * cascade), it does not fall through to the global layer just because the
 * project layer's map doesn't happen to name every pack. Exported for
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
 * are optional trailing params (default `process.env`/`existsSync`) so
 * tests can inject a hermetic environment without a real filesystem climb
 * toward `homedir()`; every production call site only ever passes
 * `(pack, cwd)`. */
export function isPackEnabled(pack, cwd = process.cwd(), env = process.env, existsFn = existsSync) {
  return readPacksConfig(cwd, env, existsFn)[pack] === true;
}
