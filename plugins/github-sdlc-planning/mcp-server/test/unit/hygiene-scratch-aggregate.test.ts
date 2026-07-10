import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
// Same rationale as hygiene-check-hook.test.ts / in-progress-hook.test.ts:
// dependency-free hooks utilities, tested here outside src/ and outside
// the coverage include.
import { sanitizeSessionId, scratchFilePath, appendScratchEntry, readScratchEntries, clearScratch } from '../../../hooks/lib/hygiene-scratch.mjs';
import { buildConsolidatedContext } from '../../../hooks/lib/hygiene-aggregate.mjs';

describe('sanitizeSessionId', () => {
  it('passes through an already-safe session id', () => {
    expect(sanitizeSessionId('abc-123_ABC.1')).toBe('abc-123_ABC.1');
  });

  it('replaces unsafe characters', () => {
    expect(sanitizeSessionId('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('falls back to a placeholder for a non-string or empty value', () => {
    expect(sanitizeSessionId(undefined)).toBe('unknown-session');
    expect(sanitizeSessionId('')).toBe('unknown-session');
  });
});

describe('scratchFilePath', () => {
  it('scopes the path under a gdlc-hygiene-scratch directory keyed by session id', () => {
    const path = scratchFilePath('sess-1', '/tmp/base');
    expect(path).toBe('/tmp/base/gdlc-hygiene-scratch/sess-1.jsonl');
  });
});

describe('appendScratchEntry + readScratchEntries', () => {
  function tmpBase(): string {
    return mkdtempSync(join(tmpdir(), 'gdlc-hygiene-scratch-'));
  }

  it('writes and reads back one entry', () => {
    const path = join(tmpBase(), 'session.jsonl');
    appendScratchEntry(path, { owner: 'acme', repo: 'widgets', number: 1, findings: ['x'] });
    const entries = readScratchEntries(path);
    expect(entries).toEqual([{ owner: 'acme', repo: 'widgets', number: 1, findings: ['x'] }]);
  });

  it('appends multiple entries across calls, creating the directory on first use', () => {
    const dir = tmpBase();
    const path = join(dir, 'nested', 'session.jsonl');
    appendScratchEntry(path, { n: 1 });
    appendScratchEntry(path, { n: 2 });
    expect(readScratchEntries(path)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('is a silent no-op when the write fails', () => {
    const failingAppend = vi.fn(() => {
      throw new Error('disk full');
    });
    expect(() => appendScratchEntry('/whatever/path.jsonl', { n: 1 }, { appendFileSync: failingAppend })).not.toThrow();
  });

  it('returns an empty array for a missing file', () => {
    expect(readScratchEntries('/nonexistent/gdlc-hygiene-scratch/none.jsonl')).toEqual([]);
  });

  it('skips malformed lines rather than throwing', () => {
    const path = join(tmpBase(), 'session.jsonl');
    appendScratchEntry(path, { n: 1 });
    appendFileSync(path, 'not json at all\n');
    appendScratchEntry(path, { n: 2 });
    expect(readScratchEntries(path)).toEqual([{ n: 1 }, { n: 2 }]);
  });
});

describe('clearScratch', () => {
  it('deletes the file so a subsequent read returns nothing -- the real write-then-clear-then-read round trip', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'gdlc-hygiene-scratch-')), 'session.jsonl');
    appendScratchEntry(path, { n: 1 });
    expect(readScratchEntries(path)).toEqual([{ n: 1 }]);

    clearScratch(path);

    expect(readScratchEntries(path)).toEqual([]);
  });

  it('is a silent no-op when the file does not exist', () => {
    expect(() => clearScratch('/nonexistent/path.jsonl')).not.toThrow();
  });

  it('is a silent no-op when unlink itself throws', () => {
    const failingUnlink = vi.fn(() => {
      throw new Error('EPERM');
    });
    expect(() => clearScratch('/whatever/path.jsonl', { unlinkSync: failingUnlink })).not.toThrow();
  });
});

describe('buildConsolidatedContext', () => {
  it('returns null for no entries', () => {
    expect(buildConsolidatedContext([])).toBeNull();
    expect(buildConsolidatedContext(undefined as unknown as unknown[])).toBeNull();
  });

  it('returns null when every entry has zero findings', () => {
    expect(buildConsolidatedContext([{ findings: [] }, { findings: [] }])).toBeNull();
  });

  it('consolidates findings across multiple touches into one message', () => {
    const entries = [
      { findings: ['a/b#1: gap one'] },
      { findings: [] },
      { findings: ['a/b#2: gap two'] },
    ];
    const text = buildConsolidatedContext(entries);
    expect(text).toContain('3 GitHub touches this turn');
    expect(text).toContain('- a/b#1: gap one');
    expect(text).toContain('- a/b#2: gap two');
  });

  it('de-duplicates an identical finding recurring across multiple touches', () => {
    const entries = [{ findings: ['same gap'] }, { findings: ['same gap'] }];
    const text = buildConsolidatedContext(entries);
    expect(text?.split('same gap')).toHaveLength(2); // appears exactly once
  });

  it('uses singular phrasing for exactly one touch', () => {
    const text = buildConsolidatedContext([{ findings: ['only gap'] }]);
    expect(text).toContain('1 GitHub touch this turn');
  });
});
