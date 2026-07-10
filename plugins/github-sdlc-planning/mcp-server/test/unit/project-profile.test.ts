import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROJECT_PROFILE_TTL_MS,
  DEFAULT_USER_PREFS,
  DOCUMENTED_LIFECYCLE_STAGES,
  computeMissingLifecycleStages,
  ensureUserPrefs,
  getOrRefreshProjectProfile,
  isProjectProfileFresh,
  projectProfilePath,
  readProjectProfile,
  readUserPrefs,
  userPrefsPath,
  writeProjectProfile,
  writeUserPrefs,
  type StatusFieldSchema,
} from '../../src/project-profile.js';

function tmpEnv(): { XDG_CONFIG_HOME: string } {
  return { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'gdlc-project-profile-')) };
}

const STATUS_FIELD: StatusFieldSchema = {
  id: 'PVTSSF_field',
  name: 'Status',
  options: [
    { id: 'a', name: 'Todo' },
    { id: 'b', name: 'In Progress' },
    { id: 'c', name: 'In Review' },
    { id: 'd', name: 'Blocked' },
    { id: 'e', name: 'Done' },
  ],
};

describe('projectProfilePath', () => {
  it('honors XDG_CONFIG_HOME when set', () => {
    expect(projectProfilePath('acme', 1, { XDG_CONFIG_HOME: '/xdg' })).toBe(join('/xdg', 'gdlc', 'projects', 'acme', '1.json'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    expect(projectProfilePath('acme', 1, {})).toBe(join(homedir(), '.config', 'gdlc', 'projects', 'acme', '1.json'));
  });

  it('sanitizes a login containing path separators into a single safe segment (no traversal)', () => {
    const sanitized = projectProfilePath('../../etc', 1, { XDG_CONFIG_HOME: '/xdg' });
    expect(sanitized).toBe(join('/xdg', 'gdlc', 'projects', '__.._etc', '1.json'));
    // The result resolves to exactly one path segment under projects/, not an
    // escape via '/': join() only ever inserts platform separators between
    // the args we passed it, and the sanitized segment itself contains none.
    const segment = sanitized.split(join('gdlc', 'projects') + '/')[1]?.split('/')[0];
    expect(segment).toBe('__.._etc');
  });

  it('sanitizes a login that is a bare leading dot', () => {
    expect(projectProfilePath('.hidden', 1, { XDG_CONFIG_HOME: '/xdg' })).toBe(join('/xdg', 'gdlc', 'projects', '_hidden', '1.json'));
  });
});

describe('userPrefsPath', () => {
  it('honors XDG_CONFIG_HOME when set', () => {
    expect(userPrefsPath({ XDG_CONFIG_HOME: '/xdg' })).toBe(join('/xdg', 'gdlc', 'user.json'));
  });

  it('falls back to ~/.config when unset', () => {
    expect(userPrefsPath({})).toBe(join(homedir(), '.config', 'gdlc', 'user.json'));
  });
});

describe('computeMissingLifecycleStages', () => {
  it('returns every documented stage when no option names are given', () => {
    expect(computeMissingLifecycleStages([])).toEqual([...DOCUMENTED_LIFECYCLE_STAGES]);
  });

  it('returns nothing missing when every documented stage has a matching option', () => {
    expect(computeMissingLifecycleStages([...DOCUMENTED_LIFECYCLE_STAGES])).toEqual([]);
  });

  it('returns exactly the stages this workspace real board is missing (Backlog, Ready)', () => {
    expect(computeMissingLifecycleStages(STATUS_FIELD.options.map((o) => o.name))).toEqual(['Backlog', 'Ready']);
  });
});

describe('readProjectProfile / writeProjectProfile', () => {
  it('returns null when no profile has ever been written', () => {
    const env = tmpEnv();
    expect(readProjectProfile('acme', 1, env)).toBeNull();
  });

  it('round-trips a written profile, deriving missingLifecycleStages from statusField', () => {
    const env = tmpEnv();
    const written = writeProjectProfile('acme', 1, STATUS_FIELD, env, {}, () => Date.parse('2026-07-10T12:00:00.000Z'));
    expect(written.missingLifecycleStages).toEqual(['Backlog', 'Ready']);
    expect(written.updatedAt).toBe('2026-07-10T12:00:00.000Z');

    const read = readProjectProfile('acme', 1, env);
    expect(read).toEqual(written);
  });

  it('caches a null statusField (unusually-shaped board) same as a real result', () => {
    const env = tmpEnv();
    const written = writeProjectProfile('acme', 1, null, env, {}, () => Date.parse('2026-07-10T12:00:00.000Z'));
    expect(written.statusField).toBeNull();
    expect(written.missingLifecycleStages).toEqual([...DOCUMENTED_LIFECYCLE_STAGES]);
    expect(readProjectProfile('acme', 1, env)).toEqual(written);
  });

  it('writes atomically: no leftover .tmp- file remains after a write', () => {
    const env = tmpEnv();
    writeProjectProfile('acme', 42, STATUS_FIELD, env);
    const dir = join(env.XDG_CONFIG_HOME, 'gdlc', 'projects', 'acme');
    const entries = readdirSync(dir);
    expect(entries).toEqual(['42.json']);
  });

  it('returns null for a malformed JSON file rather than throwing', () => {
    const env = tmpEnv();
    writeProjectProfile('acme', 1, STATUS_FIELD, env);
    const path = projectProfilePath('acme', 1, env);
    const fns = {
      existsFn: () => true,
      readFn: () => '{not valid json',
    };
    expect(readProjectProfile('acme', 1, env, fns)).toBeNull();
    expect(existsSync(path)).toBe(true); // real file untouched by the injected reader
  });

  it('returns null when missingLifecycleStages is not a string array', () => {
    const env = tmpEnv();
    const fns = {
      existsFn: () => true,
      readFn: () => JSON.stringify({ updatedAt: '2026-07-10T12:00:00.000Z', statusField: null, missingLifecycleStages: [1, 2] }),
    };
    expect(readProjectProfile('acme', 1, env, fns)).toBeNull();
  });

  it('returns null when the cached shape is structurally invalid (missing updatedAt)', () => {
    const env = tmpEnv();
    const fns = {
      existsFn: () => true,
      readFn: () => JSON.stringify({ statusField: null, missingLifecycleStages: [] }),
    };
    expect(readProjectProfile('acme', 1, env, fns)).toBeNull();
  });

  it('returns null when a statusField option is malformed', () => {
    const env = tmpEnv();
    const fns = {
      existsFn: () => true,
      readFn: () =>
        JSON.stringify({
          updatedAt: '2026-07-10T12:00:00.000Z',
          missingLifecycleStages: [],
          statusField: { id: 'x', name: 'Status', options: [{ id: 'a' }] },
        }),
    };
    expect(readProjectProfile('acme', 1, env, fns)).toBeNull();
  });

  it('keeps two different projects under the same org isolated from each other', () => {
    const env = tmpEnv();
    writeProjectProfile('acme', 1, STATUS_FIELD, env);
    expect(readProjectProfile('acme', 2, env)).toBeNull();
  });
});

describe('isProjectProfileFresh', () => {
  it('is fresh just under the TTL', () => {
    const profile = { updatedAt: new Date(1000).toISOString(), statusField: null, missingLifecycleStages: [] };
    expect(isProjectProfileFresh(profile, 1000 + DEFAULT_PROJECT_PROFILE_TTL_MS - 1)).toBe(true);
  });

  it('is stale at exactly the TTL boundary', () => {
    const profile = { updatedAt: new Date(1000).toISOString(), statusField: null, missingLifecycleStages: [] };
    expect(isProjectProfileFresh(profile, 1000 + DEFAULT_PROJECT_PROFILE_TTL_MS)).toBe(false);
  });

  it('treats a malformed updatedAt as never fresh', () => {
    const profile = { updatedAt: 'not-a-date', statusField: null, missingLifecycleStages: [] };
    expect(isProjectProfileFresh(profile, Date.now())).toBe(false);
  });
});

describe('getOrRefreshProjectProfile', () => {
  it('fetches and persists on a cold cache', async () => {
    const env = tmpEnv();
    const fetchStatusField = vi.fn().mockResolvedValue(STATUS_FIELD);
    const profile = await getOrRefreshProjectProfile('acme', 1, fetchStatusField, { env, now: () => Date.parse('2026-07-10T12:00:00.000Z') });
    expect(fetchStatusField).toHaveBeenCalledTimes(1);
    expect(profile.statusField).toEqual(STATUS_FIELD);
    expect(readProjectProfile('acme', 1, env)).toEqual(profile);
  });

  it('serves a fresh cached profile without calling fetchStatusField again', async () => {
    const env = tmpEnv();
    const now = Date.parse('2026-07-10T12:00:00.000Z');
    writeProjectProfile('acme', 1, STATUS_FIELD, env, {}, () => now);
    const fetchStatusField = vi.fn().mockResolvedValue(STATUS_FIELD);
    const profile = await getOrRefreshProjectProfile('acme', 1, fetchStatusField, { env, now: () => now + 1000 });
    expect(fetchStatusField).not.toHaveBeenCalled();
    expect(profile.statusField).toEqual(STATUS_FIELD);
  });

  it('refetches once the cached profile is past the TTL', async () => {
    const env = tmpEnv();
    const writtenAt = Date.parse('2026-07-10T12:00:00.000Z');
    writeProjectProfile('acme', 1, STATUS_FIELD, env, {}, () => writtenAt);
    const refreshed: StatusFieldSchema = { ...STATUS_FIELD, options: [...STATUS_FIELD.options, { id: 'f', name: 'Ready' }] };
    const fetchStatusField = vi.fn().mockResolvedValue(refreshed);
    const profile = await getOrRefreshProjectProfile('acme', 1, fetchStatusField, {
      env,
      now: () => writtenAt + DEFAULT_PROJECT_PROFILE_TTL_MS + 1,
    });
    expect(fetchStatusField).toHaveBeenCalledTimes(1);
    expect(profile.missingLifecycleStages).toEqual(['Backlog']);
  });

  it('caches a null fetch result (board has no Status field) rather than re-probing every call', async () => {
    const env = tmpEnv();
    const fetchStatusField = vi.fn().mockResolvedValue(null);
    const first = await getOrRefreshProjectProfile('acme', 1, fetchStatusField, { env, now: () => 1000 });
    expect(first.statusField).toBeNull();
    const second = await getOrRefreshProjectProfile('acme', 1, fetchStatusField, { env, now: () => 1000 + 1 });
    expect(fetchStatusField).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });
});

describe('user prefs', () => {
  it('readUserPrefs returns null when never written', () => {
    const env = tmpEnv();
    expect(readUserPrefs(env)).toBeNull();
  });

  it('writeUserPrefs then readUserPrefs round-trips', () => {
    const env = tmpEnv();
    writeUserPrefs(DEFAULT_USER_PREFS, env);
    expect(readUserPrefs(env)).toEqual(DEFAULT_USER_PREFS);
    expect(readFileSync(userPrefsPath(env), 'utf8')).toContain('doc-follows-board');
  });

  it('readUserPrefs returns null for a malformed value', () => {
    const env = tmpEnv();
    const fns = { existsFn: () => true, readFn: () => JSON.stringify({ lifecycleReconciliation: 'something-else' }) };
    expect(readUserPrefs(env, fns)).toBeNull();
  });

  it('ensureUserPrefs seeds the default on first use', () => {
    const env = tmpEnv();
    const prefs = ensureUserPrefs(env);
    expect(prefs).toEqual(DEFAULT_USER_PREFS);
    expect(readUserPrefs(env)).toEqual(DEFAULT_USER_PREFS);
  });

  it('ensureUserPrefs never overwrites an already-set value', () => {
    const env = tmpEnv();
    writeUserPrefs(DEFAULT_USER_PREFS, env);
    const path = userPrefsPath(env);
    const before = readFileSync(path, 'utf8');
    ensureUserPrefs(env);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
