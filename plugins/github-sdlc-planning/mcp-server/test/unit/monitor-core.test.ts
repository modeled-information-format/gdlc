import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Dependency-free monitors utility (ADR-0010), tested here for the same
// reason the hooks/lib modules are (outside src/, outside coverage, run
// with bare node by the real monitor processes).
import {
  BASE_INTERVAL_MS,
  DISABLED_RECHECK_MS,
  INITIAL_DELAY_MS,
  MAX_BACKOFF_MS,
  REEMIT_COOLDOWN_MS,
  SCRATCH_PRUNE_AGE_MS,
  parsePacksSection,
  readPacksConfig,
  isMonitorsPackEnabled,
  dedupFilePath,
  loadDedupState,
  saveDedupState,
  pruneDedupState,
  shouldEmit,
  pruneStaleScratch,
  createGraphQLRunner,
  runMonitorLoop,
} from '../../../monitors/lib/monitor-core.mjs';
import { pointerFilePath, writeSessionPointer } from '../../../hooks/lib/session-pointer.mjs';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-monitor-core-test-'));
}

describe('parsePacksSection', () => {
  it('parses boolean entries and drops everything else', () => {
    const packs = parsePacksSection(['packs:', '  monitors: true', '  hooks: false', '  bogus: maybe', 'board:', '  projectNumber: 1'].join('\n'));
    expect(packs).toEqual({ monitors: true, hooks: false });
  });

  it('strips inline comments and quotes from values', () => {
    expect(parsePacksSection('packs:\n  monitors: true  # enabled for this repo\n')).toEqual({ monitors: true });
    expect(parsePacksSection("packs:\n  monitors: 'true'\n")).toEqual({ monitors: true });
  });

  it('returns an empty map when no packs section exists', () => {
    expect(parsePacksSection('board:\n  projectNumber: 1\n')).toEqual({});
  });
});

describe('readPacksConfig / isMonitorsPackEnabled', () => {
  function hermetic(files: Record<string, string>, globalRoot: string) {
    return {
      env: { XDG_CONFIG_HOME: globalRoot } as NodeJS.ProcessEnv,
      existsFn: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
      readFn: ((p: string) => {
        if (!Object.prototype.hasOwnProperty.call(files, p)) throw new Error('ENOENT');
        return files[p];
      }) as typeof import('node:fs').readFileSync,
      ceiling: '/',
    };
  }

  it('nearest ancestor with a usable packs section wins over global', () => {
    const opts = hermetic(
      {
        '/ws/repo/.config/gdlc/config.yml': 'packs:\n  monitors: true\n',
        '/xdg/gdlc/config.yml': 'packs:\n  monitors: false\n',
      },
      '/xdg',
    );
    expect(readPacksConfig('/ws/repo/deep/dir', opts)).toEqual({ monitors: true });
    expect(isMonitorsPackEnabled('/ws/repo/deep/dir', opts)).toBe(true);
  });

  it('falls through a packs-less project file to the global layer', () => {
    const opts = hermetic(
      {
        '/ws/repo/.config/gdlc/config.yml': 'board:\n  projectNumber: 1\n',
        '/xdg/gdlc/config.yml': 'packs:\n  monitors: true\n',
      },
      '/xdg',
    );
    expect(isMonitorsPackEnabled('/ws/repo', opts)).toBe(true);
  });

  it('fail-closed: no config anywhere means disabled', () => {
    const opts = hermetic({}, '/xdg');
    expect(readPacksConfig('/ws/repo', opts)).toEqual({});
    expect(isMonitorsPackEnabled('/ws/repo', opts)).toBe(false);
  });

  it('a project candidate colliding with the global path is skipped, not double-counted', () => {
    const opts = hermetic(
      {
        '/xdg/gdlc/config.yml': 'packs:\n  monitors: true\n',
      },
      '/xdg',
    );
    // cwd sits so that '<dir>/.config/gdlc/config.yml' would BE the global
    // path only if XDG_CONFIG_HOME were '<dir>/.config' -- emulate that.
    const collide = hermetic({ '/ws/.config/gdlc/config.yml': 'packs:\n  monitors: true\n' }, '/ws/.config');
    expect(readPacksConfig('/ws/deep', collide)).toEqual({ monitors: true });
    expect(isMonitorsPackEnabled('/ws/repo', opts)).toBe(true);
  });
});

describe('dedup store', () => {
  it('round-trips and sanitizes path components', () => {
    const base = tmpBase();
    const path = dedupFilePath('sess/../1', 'board-hygiene', base);
    expect(path).toContain('sess_.._1-board-hygiene.json');
    saveDedupState(path, { 'k:1': 100 });
    expect(loadDedupState(path)).toEqual({ 'k:1': 100 });
  });

  it('degrades to an empty store on missing/malformed content', () => {
    const base = tmpBase();
    expect(loadDedupState(join(base, 'missing.json'))).toEqual({});
    const path = join(base, 'bad.json');
    writeFileSync(path, '[1,2,3]');
    expect(loadDedupState(path)).toEqual({});
    writeFileSync(path, '{"ok": 5, "bad": "x"}');
    expect(loadDedupState(path)).toEqual({ ok: 5 });
  });

  it('pruneDedupState ages out old keys and enforces the cap oldest-first', () => {
    const now = 1_000_000;
    const aged = pruneDedupState({ old: now - (24 * 60 * 60_000 + 1), fresh: now - 1000 }, now);
    expect(aged).toEqual({ fresh: now - 1000 });

    const big: Record<string, number> = {};
    for (let i = 0; i < 250; i += 1) big[`k${i}`] = now - i;
    const capped = pruneDedupState(big, now, { maxEntries: 200 });
    expect(Object.keys(capped)).toHaveLength(200);
    expect(capped.k0).toBe(now); // newest kept
    expect(capped.k249).toBeUndefined(); // oldest dropped
  });

  it('shouldEmit: new key yes, within cooldown no, past cooldown yes', () => {
    const now = 10_000_000;
    expect(shouldEmit({}, 'k', now)).toBe(true);
    expect(shouldEmit({ k: now - 1000 }, 'k', now)).toBe(false);
    expect(shouldEmit({ k: now - REEMIT_COOLDOWN_MS }, 'k', now)).toBe(true);
  });
});

describe('pruneStaleScratch', () => {
  it('removes only files older than SCRATCH_PRUNE_AGE_MS, silently skipping missing dirs', () => {
    const base = tmpBase();
    const dedupDir = join(base, 'gdlc-monitor-scratch');
    mkdirSync(dedupDir, { recursive: true });
    const oldFile = join(dedupDir, 'old.json');
    const newFile = join(dedupDir, 'new.json');
    writeFileSync(oldFile, '{}');
    writeFileSync(newFile, '{}');
    const oldSeconds = (Date.now() - SCRATCH_PRUNE_AGE_MS - 60_000) / 1000;
    utimesSync(oldFile, oldSeconds, oldSeconds);

    expect(() => pruneStaleScratch(base, Date.now())).not.toThrow();
    expect(readdirSync(dedupDir)).toEqual(['new.json']);
  });
});

describe('createGraphQLRunner', () => {
  it('builds gh args with typed -F for numbers/booleans and throws on GraphQL errors', () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const run = createGraphQLRunner({
      execFileFn: ((cmd: string, args: string[]) => {
        calls.push({ cmd, args });
        return JSON.stringify({ data: { ok: true } });
      }) as never,
    });
    expect(run('query q', { login: 'acme', number: 3, draft: false })).toEqual({ ok: true });
    expect(calls[0].cmd).toBe('gh');
    expect(calls[0].args).toEqual([
      'api',
      'graphql',
      '-f',
      'query=query q',
      '-f',
      'login=acme',
      '-F',
      'number=3',
      '-F',
      'draft=false',
    ]);

    const failing = createGraphQLRunner({
      execFileFn: (() => JSON.stringify({ errors: [{ message: 'rate limited' }] })) as never,
    });
    expect(() => failing('q')).toThrow('rate limited');
  });
});

describe('runMonitorLoop', () => {
  function harness(overrides: Record<string, unknown> = {}) {
    const base = tmpBase();
    writeSessionPointer(pointerFilePath('/ws/repo', base), { sessionId: 'sess-1', cwd: '/ws/repo', updatedAt: Date.now() });
    const written: string[] = [];
    const sleeps: number[] = [];
    return {
      base,
      written,
      sleeps,
      opts: {
        name: 'test-monitor',
        cwd: '/ws/repo',
        baseDir: base,
        isEnabledFn: () => true,
        sleepFn: async (ms: number) => {
          sleeps.push(ms);
        },
        randomFn: () => 0.5, // zero jitter
        writeFn: (line: string) => {
          written.push(line);
        },
        ...overrides,
      },
    };
  }

  it('emits one consolidated line per cycle and dedupes the next cycle', async () => {
    const { written, opts } = harness();
    await runMonitorLoop({
      ...opts,
      assess: async () => [
        { key: 'a:1', message: 'issue #1 drifted' },
        { key: 'b:2', message: 'PR #2 is settled' },
      ],
      maxCycles: 2,
    } as never);
    expect(written).toEqual(['gdlc test-monitor: issue #1 drifted | PR #2 is settled\n']);
  });

  it('re-emits a changed condition immediately (different key), throttles a persisting one', async () => {
    const { written, opts } = harness();
    let cycle = 0;
    await runMonitorLoop({
      ...opts,
      assess: async () => {
        cycle += 1;
        return [{ key: `state:${cycle === 1 ? 'sha1' : 'sha2'}`, message: `cycle ${cycle}` }];
      },
      maxCycles: 2,
    } as never);
    expect(written).toEqual(['gdlc test-monitor: cycle 1\n', 'gdlc test-monitor: cycle 2\n']);
  });

  it('idles at the disabled beat with no assess call and no output when the pack is off', async () => {
    const { written, sleeps, opts } = harness({ isEnabledFn: () => false });
    let assessed = 0;
    await runMonitorLoop({
      ...opts,
      assess: async () => {
        assessed += 1;
        return [];
      },
      maxCycles: 2,
    } as never);
    expect(assessed).toBe(0);
    expect(written).toEqual([]);
    // Initial delay, then two disabled-recheck beats.
    expect(sleeps).toEqual([INITIAL_DELAY_MS, DISABLED_RECHECK_MS, DISABLED_RECHECK_MS]);
  });

  it('stays quiet when no session pointer resolves', async () => {
    const { written, opts } = harness();
    let assessed = 0;
    await runMonitorLoop({
      ...opts,
      resolvePointerFn: () => null,
      assess: async () => {
        assessed += 1;
        return [];
      },
      maxCycles: 1,
    } as never);
    expect(assessed).toBe(0);
    expect(written).toEqual([]);
  });

  it('backs off exponentially on assess failure and recovers on success', async () => {
    const { sleeps, written, opts } = harness();
    let cycle = 0;
    await runMonitorLoop({
      ...opts,
      assess: async () => {
        cycle += 1;
        if (cycle <= 2) throw new Error('api down');
        return [{ key: 'ok', message: 'recovered' }];
      },
      maxCycles: 3,
    } as never);
    expect(sleeps[0]).toBe(INITIAL_DELAY_MS);
    expect(sleeps[1]).toBe(Math.min(BASE_INTERVAL_MS * 2, MAX_BACKOFF_MS));
    expect(sleeps[2]).toBe(Math.min(BASE_INTERVAL_MS * 4, MAX_BACKOFF_MS));
    expect(sleeps[3]).toBe(BASE_INTERVAL_MS); // recovered, jitter zeroed
    expect(written).toEqual(['gdlc test-monitor: recovered\n']);
  });

  it('returns (exits) when the stdout write throws -- the host is gone', async () => {
    const { opts } = harness({
      writeFn: () => {
        throw new Error('EPIPE');
      },
    });
    let assessed = 0;
    await runMonitorLoop({
      ...opts,
      assess: async () => {
        assessed += 1;
        return [{ key: 'k', message: 'm' }];
      },
      maxCycles: 100,
    } as never);
    expect(assessed).toBe(1);
  });

  it('drops malformed findings instead of crashing', async () => {
    const { written, opts } = harness();
    await runMonitorLoop({
      ...opts,
      assess: async () => [null, { key: 5, message: 'bad' }, { key: 'good', message: 'kept' }] as never,
      maxCycles: 1,
    } as never);
    expect(written).toEqual(['gdlc test-monitor: kept\n']);
  });
});
