import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Dependency-free hooks utility, tested here for the same reason
// in-progress-hook.test.ts is (outside src/, outside coverage, run with
// bare node by the real hooks).
import {
  sanitizeSessionId,
  activeIssuePath,
  promotedPath,
  writeActiveIssue,
  readActiveIssue,
  issueKey,
  readPromotedSet,
  markPromoted,
} from '../../../hooks/lib/first-edit-scratch.mjs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-first-edit-'));
}

describe('sanitizeSessionId', () => {
  it('passes through an already-safe id', () => {
    expect(sanitizeSessionId('abc-123')).toBe('abc-123');
  });

  it('falls back to a placeholder for non-string/empty input', () => {
    expect(sanitizeSessionId(undefined)).toBe('unknown-session');
    expect(sanitizeSessionId('')).toBe('unknown-session');
  });
});

describe('activeIssuePath / promotedPath', () => {
  it('produces distinct paths for the same session', () => {
    expect(activeIssuePath('abc', '/tmp/x')).not.toBe(promotedPath('abc', '/tmp/x'));
  });

  it('are namespaced under gdlc-first-edit', () => {
    expect(activeIssuePath('abc', '/tmp/x')).toBe(join('/tmp/x', 'gdlc-first-edit', 'abc-active.json'));
    expect(promotedPath('abc', '/tmp/x')).toBe(join('/tmp/x', 'gdlc-first-edit', 'abc-promoted.json'));
  });
});

describe('writeActiveIssue / readActiveIssue', () => {
  it('returns null when nothing has been written yet', () => {
    const path = join(tmpDir(), 'active.json');
    expect(readActiveIssue(path)).toBeNull();
  });

  it('round-trips a written ref', () => {
    const path = join(tmpDir(), 'nested', 'active.json');
    writeActiveIssue(path, { owner: 'acme', repo: 'widgets', number: 308 });
    expect(readActiveIssue(path)).toEqual({ owner: 'acme', repo: 'widgets', number: 308 });
  });

  it('overwrites (not appends) -- only the most recent write is ever read back', () => {
    const path = join(tmpDir(), 'active.json');
    writeActiveIssue(path, { owner: 'acme', repo: 'widgets', number: 1 });
    writeActiveIssue(path, { owner: 'acme', repo: 'widgets', number: 2 });
    expect(readActiveIssue(path)).toEqual({ owner: 'acme', repo: 'widgets', number: 2 });
  });

  it('returns null for a structurally invalid value rather than throwing', () => {
    const fns = { readFileSync: () => JSON.stringify({ owner: 'acme' }) };
    expect(readActiveIssue('/irrelevant', fns)).toBeNull();
  });

  it('returns null when the file cannot be read', () => {
    const fns = {
      readFileSync: () => {
        throw new Error('permission denied');
      },
    };
    expect(readActiveIssue('/irrelevant', fns)).toBeNull();
  });

  it('writeActiveIssue is a silent no-op on a write failure', () => {
    const fns = {
      writeFileSync: () => {
        throw new Error('disk full');
      },
    };
    expect(() => writeActiveIssue('/irrelevant/path.json', { owner: 'a', repo: 'b', number: 1 }, fns)).not.toThrow();
  });
});

describe('issueKey', () => {
  it('formats owner/repo#number', () => {
    expect(issueKey({ owner: 'acme', repo: 'widgets', number: 308 })).toBe('acme/widgets#308');
  });
});

describe('readPromotedSet / markPromoted', () => {
  it('returns [] when nothing has been marked yet', () => {
    const path = join(tmpDir(), 'promoted.json');
    expect(readPromotedSet(path)).toEqual([]);
  });

  it('round-trips a single marked key', () => {
    const path = join(tmpDir(), 'promoted.json');
    markPromoted(path, 'acme/widgets#308');
    expect(readPromotedSet(path)).toEqual(['acme/widgets#308']);
  });

  it('accumulates distinct keys across separate calls', () => {
    const path = join(tmpDir(), 'promoted.json');
    markPromoted(path, 'acme/widgets#308');
    markPromoted(path, 'acme/widgets#312');
    expect(readPromotedSet(path).sort()).toEqual(['acme/widgets#308', 'acme/widgets#312']);
  });

  it('gdlc#204/#214: marking the same key twice does not duplicate it (the once-per-item-per-session gate)', () => {
    const path = join(tmpDir(), 'promoted.json');
    markPromoted(path, 'acme/widgets#308');
    markPromoted(path, 'acme/widgets#308');
    expect(readPromotedSet(path)).toEqual(['acme/widgets#308']);
  });

  it('readPromotedSet returns [] for a malformed file rather than throwing', () => {
    const fns = { readFileSync: () => 'not json' };
    expect(readPromotedSet('/irrelevant', fns)).toEqual([]);
  });

  it('readPromotedSet drops non-string entries rather than throwing', () => {
    const fns = { readFileSync: () => JSON.stringify(['a/b#1', 42, null]) };
    expect(readPromotedSet('/irrelevant', fns)).toEqual(['a/b#1']);
  });
});
