import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
// Dependency-free hooks utility (ADR-0010), tested here for the same
// reason first-edit-scratch.test.ts is (outside src/, outside coverage,
// run with bare node by the real hooks and monitors).
import {
  POINTER_MAX_AGE_MS,
  pointerDirPath,
  pointerFilePath,
  writeSessionPointer,
  readSessionPointer,
  resolveSessionPointer,
} from '../../../hooks/lib/session-pointer.mjs';

function tmpBase(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-session-pointer-test-'));
}

describe('pointerFilePath', () => {
  it('is namespaced under gdlc-session-pointer with a 12-hex cwd digest', () => {
    expect(pointerFilePath('/worktrees/x', '/tmp/x')).toMatch(
      new RegExp(`^${join('/tmp/x', 'gdlc-session-pointer')}${sep === '\\' ? '\\\\' : sep}[0-9a-f]{12}\\.json$`),
    );
  });

  it('is deterministic for the same cwd and distinct across cwds', () => {
    expect(pointerFilePath('/a', '/tmp/x')).toBe(pointerFilePath('/a', '/tmp/x'));
    expect(pointerFilePath('/a', '/tmp/x')).not.toBe(pointerFilePath('/b', '/tmp/x'));
  });

  it('falls back to a stable value for a missing/non-string cwd rather than throwing', () => {
    expect(() => pointerFilePath(undefined, '/tmp/x')).not.toThrow();
    expect(pointerFilePath(undefined, '/tmp/x')).toBe(pointerFilePath('', '/tmp/x'));
  });
});

describe('writeSessionPointer / readSessionPointer', () => {
  it('round-trips a pointer, creating the directory on first use', () => {
    const base = tmpBase();
    const path = pointerFilePath('/ws/repo', base);
    const pointer = { sessionId: 'sess-1', cwd: '/ws/repo', updatedAt: 1000 };
    writeSessionPointer(path, pointer);
    expect(readSessionPointer(path)).toEqual(pointer);
  });

  it('overwrites: only the most recent session in a cwd survives', () => {
    const base = tmpBase();
    const path = pointerFilePath('/ws/repo', base);
    writeSessionPointer(path, { sessionId: 'old', cwd: '/ws/repo', updatedAt: 1000 });
    writeSessionPointer(path, { sessionId: 'new', cwd: '/ws/repo', updatedAt: 2000 });
    expect(readSessionPointer(path)?.sessionId).toBe('new');
    // Exactly one JSON document in the file, not an appended stream.
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('is a silent no-op when the write fails', () => {
    expect(() =>
      writeSessionPointer('/x/y.json', { sessionId: 's', cwd: '/x', updatedAt: 1 }, {
        writeFileSync: () => {
          throw new Error('disk full');
        },
        existsSync: () => true,
      }),
    ).not.toThrow();
  });

  it('returns null for a missing, malformed, or structurally invalid file', () => {
    const base = tmpBase();
    expect(readSessionPointer(join(base, 'nope.json'))).toBeNull();
    expect(readSessionPointer('/dev/null')).toBeNull();
    const path = pointerFilePath('/ws/repo', base);
    writeSessionPointer(path, { sessionId: '', cwd: '/ws/repo', updatedAt: 1 });
    expect(readSessionPointer(path)).toBeNull();
    writeSessionPointer(path, { sessionId: 's', cwd: '/ws/repo', updatedAt: 'soon' });
    expect(readSessionPointer(path)).toBeNull();
  });
});

describe('resolveSessionPointer', () => {
  it('prefers the exact cwd-keyed pointer when fresh', () => {
    const base = tmpBase();
    writeSessionPointer(pointerFilePath('/ws/repo', base), { sessionId: 'exact', cwd: '/ws/repo', updatedAt: 5000 });
    writeSessionPointer(pointerFilePath('/ws', base), { sessionId: 'parent', cwd: '/ws', updatedAt: 9000 });
    expect(resolveSessionPointer('/ws/repo', { baseDir: base, nowMs: 10_000 })?.sessionId).toBe('exact');
  });

  it('falls back to the freshest prefix-related pointer when no exact match exists', () => {
    const base = tmpBase();
    // A session launched at /ws whose hooks now report a worktree cwd: the
    // monitor (cwd /ws) has no exact-fresh file but the descendant's is
    // prefix-related.
    writeSessionPointer(pointerFilePath('/ws/worktrees/x', base), {
      sessionId: 'descendant',
      cwd: '/ws/worktrees/x',
      updatedAt: 8000,
    });
    writeSessionPointer(pointerFilePath('/elsewhere', base), { sessionId: 'other', cwd: '/elsewhere', updatedAt: 9000 });
    expect(resolveSessionPointer('/ws', { baseDir: base, nowMs: 10_000 })?.sessionId).toBe('descendant');
  });

  it('matches an ancestor pointer too (monitor in a worktree, session launched above it)', () => {
    const base = tmpBase();
    writeSessionPointer(pointerFilePath('/ws', base), { sessionId: 'launch', cwd: '/ws', updatedAt: 8000 });
    expect(resolveSessionPointer('/ws/repos/gdlc', { baseDir: base, nowMs: 10_000 })?.sessionId).toBe('launch');
  });

  it('never matches an unrelated sibling path on prefix alone', () => {
    const base = tmpBase();
    // '/ws/repo-b' is NOT under '/ws/repo' -- a naive startsWith without the
    // separator would wrongly match it.
    writeSessionPointer(pointerFilePath('/ws/repo-b', base), { sessionId: 'sib', cwd: '/ws/repo-b', updatedAt: 8000 });
    expect(resolveSessionPointer('/ws/repo', { baseDir: base, nowMs: 10_000 })).toBeNull();
  });

  it('ignores pointers older than POINTER_MAX_AGE_MS', () => {
    const base = tmpBase();
    writeSessionPointer(pointerFilePath('/ws/repo', base), { sessionId: 'stale', cwd: '/ws/repo', updatedAt: 0 });
    expect(resolveSessionPointer('/ws/repo', { baseDir: base, nowMs: POINTER_MAX_AGE_MS + 1 })).toBeNull();
  });

  it('resolves to null when the pointer directory does not exist at all', () => {
    expect(resolveSessionPointer('/ws/repo', { baseDir: join(tmpBase(), 'missing'), nowMs: 1000 })).toBeNull();
  });

  it('picks the freshest among several related candidates', () => {
    const base = tmpBase();
    writeSessionPointer(pointerFilePath('/ws/a', base), { sessionId: 'older', cwd: '/ws/a', updatedAt: 5000 });
    writeSessionPointer(pointerFilePath('/ws/b', base), { sessionId: 'newer', cwd: '/ws/b', updatedAt: 9000 });
    expect(resolveSessionPointer('/ws', { baseDir: base, nowMs: 10_000 })?.sessionId).toBe('newer');
  });

  it('exposes the pointer directory path for pruning callers', () => {
    expect(pointerDirPath('/tmp/x')).toBe(join('/tmp/x', 'gdlc-session-pointer'));
  });
});
