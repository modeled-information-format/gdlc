import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The control-plane reader is a dependency-free hooks utility; it is tested
// here so the plugin's single vitest rig covers it, but it is intentionally
// outside src/ (and outside the coverage include) because hooks run it with
// bare node, not through the bundled server. Mirrors github-bug-capture's
// mcp-server/test/unit/pack-toggles.test.ts (issue #183) -- same reader
// shape, deliberately re-implemented per plugin rather than shared.
import { KNOWN_PACKS, isPackEnabled, parsePacksSection, readPacksConfig } from '../../../hooks/lib/settings.mjs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'sdlc-planning-config-'));
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

const ENABLED_SKIP = 'packs:\n  skipMutationConfirm: true\n';

describe('parsePacksSection', () => {
  it('reads a well-formed packs map', () => {
    expect(parsePacksSection(ENABLED_SKIP)).toEqual({ found: true, packs: { skipMutationConfirm: true } });
  });

  it('reports found: false when there is no packs: key at all', () => {
    expect(parsePacksSection('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n')).toEqual({
      found: false,
      packs: {},
    });
  });

  it('stops the map at the first non-indented line', () => {
    const text = 'packs:\n  skipMutationConfirm: true\nother: value\n  gh-aw: true\n';
    expect(parsePacksSection(text)).toEqual({ found: true, packs: { skipMutationConfirm: true } });
  });

  it('ignores non-boolean and malformed values (fail closed)', () => {
    const text = 'packs:\n  skipMutationConfirm: yes\n  hooks: TRUE\n  triage-skills: true\n';
    expect(parsePacksSection(text)).toEqual({ found: true, packs: { 'triage-skills': true } });
  });

  it('strips an inline comment from the value, matching a real YAML parser', () => {
    const text = 'packs:\n  skipMutationConfirm: true  # epic-pipeline needs this\n';
    expect(parsePacksSection(text)).toEqual({ found: true, packs: { skipMutationConfirm: true } });
  });
});

describe('readPacksConfig', () => {
  it('is empty when neither layer has a file', () => {
    // An injected existsFn keeps the upward search hermetic -- a real climb
    // to the filesystem root risks a false match against whatever the
    // test-running machine's real ancestor directories happen to contain.
    const dir = tmpDir();
    expect(readPacksConfig(dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toEqual({});
  });

  it('reads the project layer when present', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, ENABLED_SKIP);
    expect(readPacksConfig(dir, fakeEnv(join(dir, 'no-such-global')))).toEqual({ skipMutationConfirm: true });
  });

  it('falls back to the global layer when the project layer has no packs: section', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, ENABLED_SKIP);
    expect(readPacksConfig(dir, fakeEnv(globalRoot))).toEqual({ skipMutationConfirm: true });
  });

  it('project packs: section wholly replaces global, not merged key-by-key', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, ENABLED_SKIP);
    writeProjectConfig(dir, 'packs:\n  hooks: true\n');
    expect(readPacksConfig(dir, fakeEnv(globalRoot))).toEqual({ hooks: true });
  });
});

describe('isPackEnabled', () => {
  // env/existsFn are optional trailing params on isPackEnabled purely for
  // this hermetic injection -- every production call site (confirm-mutation.mjs)
  // only ever passes (pack).
  it('is false when no config is found anywhere -- confirm-mutation.mjs keeps asking by default', () => {
    const dir = tmpDir();
    expect(isPackEnabled('skipMutationConfirm', dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toBe(false);
  });

  it('is true only for an explicit true at the project layer', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, ENABLED_SKIP);
    const env = fakeEnv(join(dir, 'no-such-global'));
    expect(isPackEnabled('skipMutationConfirm', dir, env)).toBe(true);
    expect(isPackEnabled('hooks', dir, env)).toBe(false);
  });

  it('knows the one pack this plugin defines', () => {
    expect(KNOWN_PACKS).toEqual(['skipMutationConfirm']);
  });
});
