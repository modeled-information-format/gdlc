import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGlobalConfigRoot } from '../../src/xdg.js';

// Copilot review finding on gdlc#205: extracted out of config.ts (which
// unconditionally imports 'yaml') so project-profile.ts can depend on this
// one function without transitively requiring node_modules -- see
// project-profile.test.ts's "dependency-free import chain" describe block
// for the structural guard against that coupling coming back.
describe('resolveGlobalConfigRoot', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    expect(resolveGlobalConfigRoot({ XDG_CONFIG_HOME: '/xdg/config' } as NodeJS.ProcessEnv)).toBe('/xdg/config');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    expect(resolveGlobalConfigRoot({} as NodeJS.ProcessEnv)).toBe(join(homedir(), '.config'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is empty', () => {
    expect(resolveGlobalConfigRoot({ XDG_CONFIG_HOME: '' } as NodeJS.ProcessEnv)).toBe(join(homedir(), '.config'));
  });

  it('defaults to process.env when no env is given', () => {
    expect(typeof resolveGlobalConfigRoot()).toBe('string');
  });
});
