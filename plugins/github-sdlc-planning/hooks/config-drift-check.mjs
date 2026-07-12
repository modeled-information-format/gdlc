#!/usr/bin/env node
// ADR-0009 / Story #264: passive, non-blocking config-drift detection --
// the "keep configuration up to date with minimal active involvement" half
// of the configure-gdlc epic. A one-time elicitation agent doesn't help
// once a file exists and later drifts from the schema (this already
// happened for real: #247/#248, a loader field shipped without its schema
// entry, caught only by chance) or from live GitHub state (a board/repo
// that gets deleted or renamed out from under an already-written config).
// Same non-blocking-advisory pattern as hygiene-check.mjs: never throws,
// never blocks, silent (no additionalContext) when nothing is wrong.
//
// Schema validation shells out to the already-built, self-contained
// dist/validate-gdlc-config.js bundle (same reasoning as validate-mif.mjs
// importing dist/mif.js directly) -- this hook itself stays dependency-free
// at runtime, importing only node builtins plus this plugin's own
// dependency-free hooks/lib/in-progress.mjs helpers (board resolution).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveGdlcConfigPath,
  resolveGlobalGdlcConfigRoot,
  findAllGdlcProjectConfigPaths,
  readBoardConfig,
} from './lib/in-progress.mjs';

const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = join(HOOK_DIR, '..', 'mcp-server', 'dist', 'validate-gdlc-config.js');

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function collectConfigPaths(cwd, env) {
  const paths = findAllGdlcProjectConfigPaths(cwd, existsSync, env);
  const globalPath = resolveGdlcConfigPath(resolveGlobalGdlcConfigRoot(env));
  if (existsSync(globalPath) && !paths.includes(globalPath)) paths.push(globalPath);
  return paths;
}

function validateFile(path) {
  if (!existsSync(VALIDATOR_PATH)) return null; // not built yet — nothing this hook can check
  try {
    execFileSync('node', [VALIDATOR_PATH, path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { path, valid: true, errors: [] };
  } catch (err) {
    try {
      const parsed = JSON.parse(String(err.stdout ?? '{}'));
      return { path, valid: false, errors: parsed.errors ?? [] };
    } catch {
      return { path, valid: false, errors: [{ section: '(unknown)', message: 'validator failed to run' }] };
    }
  }
}

/** Best-effort, short-timeout live check -- never lets a slow/unauthenticated
 * `gh` call hang session start. Returns true/false/null (null = couldn't tell,
 * e.g. gh not authenticated -- distinct from a confirmed-gone resource, so a
 * transient auth hiccup never gets reported as "the board was deleted"). */
function ghResourceExists(args) {
  try {
    execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    return true;
  } catch (err) {
    const stderr = String(err.stderr ?? '');
    if (/could not resolve|not found|404/i.test(stderr)) return false;
    return null; // auth issue, network issue, timeout, etc. — inconclusive, not drift
  }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();
  const env = process.env;

  const paths = collectConfigPaths(cwd, env);
  if (paths.length === 0) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const validations = paths.map(validateFile).filter(Boolean);
  const invalid = validations.filter((v) => !v.valid);
  if (invalid.length > 0) {
    const summary = invalid
      .map((v) => `${v.path}: ${v.errors.map((e) => `${e.section} — ${e.message}`).join('; ')}`)
      .join(' | ');
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `gdlc config drift: schema-invalid config file(s) found — ${summary}. Run the configure-gdlc skill to fix.`,
        },
      }),
    );
    return;
  }

  // Schema is clean — best-effort live-state spot-check, board only (no
  // dependency-free destination.repo reader exists yet; adding one is a
  // reasonable follow-up, not required for this check to be useful).
  const board = readBoardConfig(cwd, env);
  if (!board) {
    process.stdout.write(JSON.stringify({}));
    return;
  }
  const exists = ghResourceExists(['project', 'view', String(board.projectNumber), '--owner', board.projectOwnerLogin]);
  if (exists === false) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `gdlc config drift: configured board (owner ${board.projectOwnerLogin}, project ${board.projectNumber}) no longer resolves — it may have been deleted or renumbered. Run the configure-gdlc skill to update it.`,
        },
      }),
    );
    return;
  }

  process.stdout.write(JSON.stringify({}));
}

main();
