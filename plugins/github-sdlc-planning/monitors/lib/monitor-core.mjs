/**
 * ADR-0010 (docs/decisions/adr-0010-session-monitors.md): the shared
 * poll -> assess -> emit-once harness every gdlc background monitor runs
 * on. A monitor is a persistent process the Claude Code host starts from
 * `monitors/monitors.json`; every stdout line it emits is delivered to the
 * acting model as a notification, so the whole contract of this module is
 * "stay silent unless something needs saying, say it once, and never die."
 *
 * Division of labor (ADR-0007 vs ADR-0010): the hygiene HOOKS are
 * event-driven -- they react to the tool call they observe. A MONITOR is
 * time-driven -- it catches drift *between* events (an issue sitting In
 * Progress with uncommitted work, a PR whose review landed while the model
 * moved on). Monitors are advisory only and never mutate anything; the one
 * writer of board state remains set-in-progress.mjs (ADR-0003).
 *
 * Byte-identical copies of this file ship in every monitor-bearing plugin
 * (github-sdlc-planning is canonical), kept in sync by the same CI drift
 * check as the ADR-0007 hygiene family. The `packs:` reader below is
 * deliberately re-implemented here rather than imported from
 * github-sdlc-planning's hooks/lib/settings.mjs: that module (and the
 * in-progress.mjs path plumbing it leans on) exists only in the planning
 * plugin, and a byte-copied file cannot import something its sibling
 * plugins don't ship. Same per-plugin-boundary duplication reasoning as
 * github-bug-capture's own hooks/lib/settings.mjs.
 *
 * Everything here is dependency-free (bare node, no node_modules at
 * monitor-execution time) and dependency-injected for I/O, clock, sleep,
 * and randomness, so the mcp-server vitest suites can drive whole cycles
 * hermetically.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { resolveSessionPointer } from '../../hooks/lib/session-pointer.mjs';

/* ------------------------------------------------------------------ */
/* Tuning constants (v1 ships these fixed; a `monitors:` config        */
/* section was deliberately deferred -- see ADR-0010)                  */
/* ------------------------------------------------------------------ */

/** Base poll interval. ~40 GraphQL calls/hour/monitor, trivial against
 * GitHub's 5000/hour budget. */
export const BASE_INTERVAL_MS = 90_000;
/** Uniform +/- jitter applied to every cycle, so several monitors started
 * in the same instant don't thundering-herd the API on the same beat. */
export const JITTER_MS = 20_000;
/** Never nudge a session that just started: the first assessment waits
 * this long after process start. */
export const INITIAL_DELAY_MS = 120_000;
/** While the `monitors` pack is disabled/unconfigured the loop idles at
 * this slower beat, with zero GitHub calls and zero output. It must NOT
 * exit: a dead monitor stays dead until session restart, which would make
 * mid-session enablement impossible. */
export const DISABLED_RECHECK_MS = 300_000;
/** Exponential backoff ceiling after consecutive assess/API failures. */
export const MAX_BACKOFF_MS = 900_000;
/** Minimum interval before the SAME dedup key may be re-emitted for a
 * still-persisting condition. State changes re-arm immediately because
 * they produce a different key. */
export const REEMIT_COOLDOWN_MS = 30 * 60_000;
/** Dedup entries older than this are pruned; the store is also hard-capped. */
export const DEDUP_MAX_AGE_MS = 24 * 60 * 60_000;
export const DEDUP_MAX_ENTRIES = 200;
/** Best-effort startup pruning removes scratch/pointer files older than this. */
export const SCRATCH_PRUNE_AGE_MS = 7 * 24 * 60 * 60_000;

/* ------------------------------------------------------------------ */
/* `packs:` slice reader (fail-closed, self-contained -- see header)   */
/* ------------------------------------------------------------------ */

const GDLC_CONFIG_RELPATH = join('gdlc', 'config.yml');

function resolveGlobalConfigPath(env) {
  const root = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME !== '' ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
  return join(root, GDLC_CONFIG_RELPATH);
}

/** Same quoted/inline-comment scalar handling as in-progress.mjs's
 * extractScalarValue -- an inline comment must not become part of the value. */
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

/** Parse a top-level `packs:` boolean map out of a plain-YAML gdlc
 * config document -- same constrained 2-space-indent parsing as
 * settings.mjs's parsePacksSection; malformed or non-boolean entries are
 * dropped, not thrown. Exported for tests. */
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
  return packs;
}

function readLayerPacks(path, readFn) {
  let text;
  try {
    text = readFn(path, 'utf8');
  } catch {
    return null;
  }
  const packs = parsePacksSection(text);
  return Object.keys(packs).length > 0 ? packs : null;
}

/** ADR-0004/0008 resolution, re-implemented for the byte-copy boundary
 * (see header): the NEAREST ancestor of `cwd` whose
 * `.config/gdlc/config.yml` defines a usable `packs:` section wins wholly;
 * only when no ancestor does, the global `$XDG_CONFIG_HOME/gdlc/config.yml`
 * layer applies. The climb stops at `homedir()` (exclusive) and skips a
 * candidate that collides with the global layer's own resolved path --
 * both guards match in-progress.mjs's proven walk. Exported for tests. */
export function readPacksConfig(cwd, { env = process.env, existsFn = existsSync, readFn = readFileSync, ceiling = homedir() } = {}) {
  const globalPath = resolvePath(resolveGlobalConfigPath(env));
  const ceilingResolved = resolvePath(ceiling);
  let dir = resolvePath(cwd);
  for (;;) {
    if (dir === ceilingResolved) break;
    const candidate = join(dir, '.config', GDLC_CONFIG_RELPATH);
    if (resolvePath(candidate) !== globalPath && existsFn(candidate)) {
      const packs = readLayerPacks(candidate, readFn);
      if (packs !== null) return packs;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return readLayerPacks(globalPath, readFn) ?? {};
}

/** Fail-closed: only an explicit `monitors: true` in the resolved `packs:`
 * map enables the monitors. Checked EVERY cycle so mid-session config
 * edits take effect without a restart. */
export function isMonitorsPackEnabled(cwd, opts = {}) {
  return readPacksConfig(cwd, opts).monitors === true;
}

/* ------------------------------------------------------------------ */
/* Dedup store (emit-once)                                             */
/* ------------------------------------------------------------------ */

const DEDUP_DIR_NAME = 'gdlc-monitor-scratch';

function sanitizeComponent(value) {
  const cleaned = String(value ?? '').replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned === '' ? 'unknown' : cleaned;
}

export function dedupDirPath(baseDir = tmpdir()) {
  return join(baseDir, DEDUP_DIR_NAME);
}

export function dedupFilePath(sessionId, monitorName, baseDir = tmpdir()) {
  return join(dedupDirPath(baseDir), `${sanitizeComponent(sessionId)}-${sanitizeComponent(monitorName)}.json`);
}

/** Load the key -> lastEmittedAtMs map; missing/unreadable/malformed all
 * degrade to an empty store (worst case: one repeated nudge, never a
 * crash). Exported for tests. */
export function loadDedupState(path, fns = {}) {
  const read = fns.readFileSync ?? readFileSync;
  let value;
  try {
    value = JSON.parse(read(path, 'utf8'));
  } catch {
    return {};
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const state = {};
  for (const [key, at] of Object.entries(value)) {
    if (typeof at === 'number') state[key] = at;
  }
  return state;
}

export function saveDedupState(path, state, fns = {}) {
  const mkdir = fns.mkdirSync ?? mkdirSync;
  const exists = fns.existsSync ?? existsSync;
  const write = fns.writeFileSync ?? writeFileSync;
  try {
    const dir = dirname(path);
    if (dir && !exists(dir)) mkdir(dir, { recursive: true });
    write(path, JSON.stringify(state), 'utf8');
  } catch {
    // silent no-op: losing dedup state costs at most a repeated nudge
  }
}

/** Age out old keys and enforce the hard cap (oldest dropped first) so a
 * very long session can't grow the store without bound. Pure. Exported
 * for tests. */
export function pruneDedupState(state, nowMs, { maxAgeMs = DEDUP_MAX_AGE_MS, maxEntries = DEDUP_MAX_ENTRIES } = {}) {
  let entries = Object.entries(state).filter(([, at]) => nowMs - at <= maxAgeMs);
  if (entries.length > maxEntries) {
    entries = entries.sort((a, b) => b[1] - a[1]).slice(0, maxEntries);
  }
  return Object.fromEntries(entries);
}

/** A finding may be emitted when its state-qualified key has never been
 * emitted, or its last emission is older than the cooldown (a persisting
 * condition gets an occasional reminder; a CHANGED condition produces a
 * different key and re-arms immediately). Pure. */
export function shouldEmit(state, key, nowMs, cooldownMs = REEMIT_COOLDOWN_MS) {
  const last = state[key];
  return typeof last !== 'number' || nowMs - last >= cooldownMs;
}

/* ------------------------------------------------------------------ */
/* Startup pruning of this feature's own tmpdir footprint              */
/* ------------------------------------------------------------------ */

/** Best-effort: delete files older than SCRATCH_PRUNE_AGE_MS from the
 * dedup and session-pointer directories. Every failure is a silent no-op;
 * a monitor never dies over housekeeping. Exported for tests. */
export function pruneStaleScratch(baseDir = tmpdir(), nowMs = Date.now(), fns = {}) {
  const readdir = fns.readdirSync ?? readdirSync;
  const stat = fns.statSync ?? statSync;
  const unlink = fns.unlinkSync ?? unlinkSync;
  for (const dir of [dedupDirPath(baseDir), join(baseDir, 'gdlc-session-pointer')]) {
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry);
      try {
        if (nowMs - stat(path).mtimeMs > SCRATCH_PRUNE_AGE_MS) unlink(path);
      } catch {
        // silent no-op
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* GraphQL runner                                                      */
/* ------------------------------------------------------------------ */

/** Same `gh api graphql` wrapper shape as set-in-progress.mjs's
 * runGraphQL, plus a time-box and output bound -- a monitor cycle must
 * never hang on a wedged subprocess. Throws on any failure; the loop's
 * per-cycle catch turns that into backoff, never death. */
export function createGraphQLRunner({ execFileFn = execFileSync } = {}) {
  return function runGraphQL(query, variables = {}) {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      if (typeof value === 'number' || typeof value === 'boolean') {
        args.push('-F', `${key}=${value}`);
      } else {
        args.push('-f', `${key}=${value}`);
      }
    }
    const raw = execFileFn('gh', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = JSON.parse(raw);
    if (parsed.errors?.length) {
      throw new Error(parsed.errors.map((e) => e.message).join('; '));
    }
    return parsed.data;
  };
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

function defaultSleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Run one monitor forever. `assess({ sessionId, cwd, runGraphQL, nowMs })`
 * is the only plugin-specific piece: it returns an array of findings
 * `{ key, message }` where `key` is state-qualified (encodes the observed
 * state, e.g. a head sha or a status-changed-at timestamp) so a changed
 * condition re-arms immediately while a persisting one is throttled by the
 * cooldown. All fresh findings in a cycle collapse into ONE stdout line
 * (the hygiene-aggregate consolidation precedent) prefixed
 * `gdlc <name>: ` -- stdout is the notification channel, so one line is
 * one nudge.
 *
 * Failure containment: each cycle body is try/caught into exponential
 * backoff; the only deliberate exit is a failed stdout write (EPIPE -- the
 * host is gone). `maxCycles` bounds the loop for tests only; production
 * callers omit it and the loop runs until the session ends. */
export async function runMonitorLoop({
  name,
  assess,
  cwd = process.cwd(),
  baseDir = tmpdir(),
  runGraphQL = createGraphQLRunner(),
  isEnabledFn = (dir) => isMonitorsPackEnabled(dir),
  resolvePointerFn = (dir, nowMs) => resolveSessionPointer(dir, { baseDir, nowMs }),
  sleepFn = defaultSleep,
  nowFn = Date.now,
  randomFn = Math.random,
  writeFn = (line) => process.stdout.write(line),
  fns = {},
  maxCycles = Infinity,
}) {
  pruneStaleScratch(baseDir, nowFn(), fns);
  await sleepFn(INITIAL_DELAY_MS);

  let failures = 0;
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    let delayMs = BASE_INTERVAL_MS + Math.round((randomFn() * 2 - 1) * JITTER_MS);
    try {
      if (!isEnabledFn(cwd)) {
        delayMs = DISABLED_RECHECK_MS;
      } else {
        const nowMs = nowFn();
        const pointer = resolvePointerFn(cwd, nowMs);
        if (pointer) {
          const findings = await assess({ sessionId: pointer.sessionId, cwd, runGraphQL, nowMs });
          const path = dedupFilePath(pointer.sessionId, name, baseDir);
          const state = pruneDedupState(loadDedupState(path, fns), nowMs);
          const fresh = (findings ?? []).filter(
            (f) => f && typeof f.key === 'string' && typeof f.message === 'string' && shouldEmit(state, f.key, nowMs),
          );
          if (fresh.length > 0) {
            try {
              writeFn(`gdlc ${name}: ${fresh.map((f) => f.message).join(' | ')}\n`);
            } catch {
              // stdout is gone -- the host died; this process has no reason to live
              return;
            }
            for (const f of fresh) state[f.key] = nowMs;
            saveDedupState(path, state, fns);
          }
        }
        failures = 0;
      }
    } catch {
      failures += 1;
      delayMs = Math.min(BASE_INTERVAL_MS * 2 ** failures, MAX_BACKOFF_MS);
    }
    await sleepFn(delayMs);
  }
}
