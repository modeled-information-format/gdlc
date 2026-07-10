import { homedir } from 'node:os';
import { join } from 'node:path';

/** Copilot review finding on gdlc#205's project-profile.ts: that module's
 * own doc comment claims to be importable dependency-free by a bare-node
 * hook (no node_modules at hook-execution time), but it imported
 * `resolveGlobalConfigRoot` from `config.ts`, which unconditionally
 * imports the `yaml` package at module scope for its own YAML-parsing
 * needs -- loading `project-profile.js` that way would transitively try to
 * load `yaml` and crash outside node_modules, exactly the scenario the
 * doc comment claimed was safe. This module holds only the one function
 * that's genuinely shared and genuinely dependency-free (`node:os`/
 * `node:path` builtins only, always available with or without
 * node_modules) -- `config.ts` and `project-profile.ts` both import it
 * from here instead of one depending on the other. */
export function resolveGlobalConfigRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}
