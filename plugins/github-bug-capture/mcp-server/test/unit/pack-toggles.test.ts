import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The control-plane reader is a dependency-free hooks utility; it is tested
// here so the plugin's single vitest rig covers it, but it is intentionally
// outside src/ (and outside the coverage include) because hooks run it with
// bare node, not through the bundled server.
import { KNOWN_PACKS, isPackEnabled, parsePacksSection, readPacksConfig } from '../../../hooks/lib/settings.mjs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'bug-capture-config-'));
}

function writeProjectConfig(root: string, contents: string): string {
  const dir = join(root, '.config', 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
  return root;
}

function fakeEnv(globalRoot: string): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: globalRoot };
}

function writeGlobalConfig(globalRoot: string, contents: string): void {
  const dir = join(globalRoot, 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
}

const ENABLED_HOOKS = 'packs:\n  hooks: true\n  gh-aw: false\n';

describe('parsePacksSection', () => {
  it('reads a well-formed packs map', () => {
    expect(parsePacksSection(ENABLED_HOOKS)).toEqual({ hooks: true, 'gh-aw': false });
  });

  it('returns empty when there is no packs: key at all', () => {
    expect(parsePacksSection('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n')).toEqual({});
  });

  it('stops the map at the first non-indented line', () => {
    const text = 'packs:\n  hooks: true\nother: value\n  gh-aw: true\n';
    expect(parsePacksSection(text)).toEqual({ hooks: true });
  });

  it('ignores non-boolean and malformed values (fail closed)', () => {
    const text = 'packs:\n  hooks: yes\n  gh-aw: TRUE\n  triage-skills: true\n';
    expect(parsePacksSection(text)).toEqual({ 'triage-skills': true });
  });

  it('strips an inline comment from the value, matching a real YAML parser', () => {
    const text = 'packs:\n  hooks: true  # enabled for this repo\n';
    expect(parsePacksSection(text)).toEqual({ hooks: true });
  });
});

describe('readPacksConfig', () => {
  it('ADR-0006: is empty when neither layer has a file', () => {
    // An injected existsFn keeps the upward search hermetic -- a real climb
    // to the filesystem root risks a false match against whatever the
    // test-running machine's real ancestor directories happen to contain
    // (same rationale as the sibling config.test.ts's identical test).
    const dir = tmpDir();
    expect(readPacksConfig(dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toEqual({});
  });

  it('ADR-0006: reads the project layer when present', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, ENABLED_HOOKS);
    expect(readPacksConfig(dir, fakeEnv(join(dir, 'no-such-global')))).toEqual({ hooks: true, 'gh-aw': false });
  });

  it('ADR-0006: falls back to the global layer when the project layer has no packs: section', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, 'packs:\n  triage-skills: true\n');
    expect(readPacksConfig(dir, fakeEnv(globalRoot))).toEqual({ 'triage-skills': true });
  });

  it('ADR-0006: project packs: section wholly replaces global, not merged key-by-key', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, 'packs:\n  hooks: true\n  gh-aw: true\n');
    writeProjectConfig(dir, 'packs:\n  triage-skills: true\n');
    expect(readPacksConfig(dir, fakeEnv(globalRoot))).toEqual({ 'triage-skills': true });
  });

  // ADR-0008 / gdlc#227: a nearer ancestor's config.yml that defines only
  // board: (no packs: section at all) must not shadow a packs: section set
  // at a FURTHER ancestor -- the search has to keep climbing past the
  // board-only file instead of stopping there and falling straight through
  // to the global layer.
  it('does not let a nearer ancestor config with only board: shadow packs: set at a further ancestor', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, 'packs:\n  triage-skills: true\n');
    writeProjectConfig(outer, ENABLED_HOOKS);
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');

    expect(readPacksConfig(inner, fakeEnv(globalRoot))).toEqual({ hooks: true, 'gh-aw': false });
  });

  // ADR-0008: the sharper case a first fix attempt got wrong -- a nearer
  // ancestor's file HAS the packs: header, but it resolves to zero valid
  // parsed content (comment-only body). This must ALSO not shadow a
  // further ancestor's real value.
  it('does not let a nearer ancestor with a present-but-empty packs: header shadow a further ancestor', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, 'packs:\n  triage-skills: true\n');
    writeProjectConfig(outer, ENABLED_HOOKS);
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'packs:\n  # nothing configured yet\n');

    expect(readPacksConfig(inner, fakeEnv(globalRoot))).toEqual({ hooks: true, 'gh-aw': false });
  });

  it('still falls through to global when NO ancestor at all defines packs:, board-only files included', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, 'packs:\n  triage-skills: true\n');
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');

    expect(readPacksConfig(inner, fakeEnv(globalRoot))).toEqual({ 'triage-skills': true });
  });
});

describe('isPackEnabled', () => {
  // env/existsFn are optional trailing params on isPackEnabled purely for
  // this hermetic injection -- every production call site in skills/hooks
  // only ever passes (pack, cwd).
  it('is false when no config is found anywhere', () => {
    const dir = tmpDir();
    expect(isPackEnabled('hooks', dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toBe(false);
  });

  it('is true only for an explicit true at the project layer', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, ENABLED_HOOKS);
    const env = fakeEnv(join(dir, 'no-such-global'));
    expect(isPackEnabled('hooks', dir, env)).toBe(true);
    expect(isPackEnabled('gh-aw', dir, env)).toBe(false);
    expect(isPackEnabled('triage-skills', dir, env)).toBe(false);
  });

  it('knows the four blueprint packs', () => {
    expect(KNOWN_PACKS).toEqual(['hooks', 'triage-skills', 'mcp-integration', 'gh-aw']);
  });
});
