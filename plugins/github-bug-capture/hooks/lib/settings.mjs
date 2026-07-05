/**
 * Pack-toggle reader — the enhancement-pack control plane (issue #47).
 *
 * Reads `.claude/github-bug-capture.local.md` frontmatter and answers "is
 * this pack enabled?". Deliberately dependency-free: the schema is
 * constrained to a `packs:` map of `key: true|false` lines, so line parsing
 * is sufficient and hooks can run it with bare `node`.
 *
 * Fail-closed by design: missing file, missing map, missing key, malformed
 * frontmatter, or a non-`true` value all mean DISABLED. The Layer 1 core
 * never consults this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const KNOWN_PACKS = ['hooks', 'triage-skills', 'mcp-integration', 'gh-aw'];

const SETTINGS_RELPATH = join('.claude', 'github-bug-capture.local.md');

/** Parse the frontmatter block and return the packs map. Exported for tests. */
export function parsePackToggles(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines[0] !== '---') return {};
  const packs = {};
  let inPacks = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '---') break;
    if (/^packs:\s*$/.test(line)) {
      inPacks = true;
      continue;
    }
    if (inPacks) {
      const m = /^ {2}([a-z][a-z-]*):\s*(true|false)\s*$/.exec(line);
      if (m) {
        packs[m[1]] = m[2] === 'true';
        continue;
      }
      // A malformed indented entry is skipped (that key stays disabled);
      // the first non-indented line ends the map.
      if (/^ {2}\S/.test(line)) continue;
      inPacks = false;
    }
  }
  return packs;
}

/** True only when the settings file explicitly sets the pack to `true`. */
export function isPackEnabled(pack, projectDir = process.cwd()) {
  let text;
  try {
    text = readFileSync(join(projectDir, SETTINGS_RELPATH), 'utf8');
  } catch {
    return false;
  }
  return parsePackToggles(text)[pack] === true;
}
