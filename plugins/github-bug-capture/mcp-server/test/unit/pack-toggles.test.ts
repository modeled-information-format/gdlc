import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The control-plane reader is a dependency-free hooks utility; it is tested
// here so the plugin's single vitest rig covers it, but it is intentionally
// outside src/ (and outside the coverage include) because hooks run it with
// bare node, not through the bundled server.
import { KNOWN_PACKS, isPackEnabled, parsePackToggles } from '../../../hooks/lib/settings.mjs';

function projectWith(settings: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'bug-capture-settings-'));
  if (settings !== null) {
    mkdirSync(join(dir, '.claude'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'github-bug-capture.local.md'), settings);
  }
  return dir;
}

const ENABLED_HOOKS = `---\npacks:\n  hooks: true\n  gh-aw: false\n---\nnotes\n`;

describe('parsePackToggles', () => {
  it('reads a well-formed packs map', () => {
    expect(parsePackToggles(ENABLED_HOOKS)).toEqual({ hooks: true, 'gh-aw': false });
  });

  it('returns empty for content without frontmatter', () => {
    expect(parsePackToggles('packs:\n  hooks: true\n')).toEqual({});
  });

  it('stops the map at the first non-entry line', () => {
    const text = `---\npacks:\n  hooks: true\nother: value\n  gh-aw: true\n---\n`;
    expect(parsePackToggles(text)).toEqual({ hooks: true });
  });

  it('ignores non-boolean and malformed values (fail closed)', () => {
    const text = `---\npacks:\n  hooks: yes\n  gh-aw: TRUE\n  triage-skills: true\n---\n`;
    expect(parsePackToggles(text)).toEqual({ 'triage-skills': true });
  });

  it('stops at the closing frontmatter fence', () => {
    const text = `---\npacks:\n  hooks: true\n---\npacks:\n  gh-aw: true\n`;
    expect(parsePackToggles(text)).toEqual({ hooks: true });
  });
});

describe('isPackEnabled', () => {
  it('is false when the settings file is absent', () => {
    expect(isPackEnabled('hooks', projectWith(null))).toBe(false);
  });

  it('is true only for an explicit true', () => {
    const dir = projectWith(ENABLED_HOOKS);
    expect(isPackEnabled('hooks', dir)).toBe(true);
    expect(isPackEnabled('gh-aw', dir)).toBe(false);
    expect(isPackEnabled('triage-skills', dir)).toBe(false);
  });

  it('knows the four blueprint packs', () => {
    expect(KNOWN_PACKS).toEqual(['hooks', 'triage-skills', 'mcp-integration', 'gh-aw']);
  });
});
