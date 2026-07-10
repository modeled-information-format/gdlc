import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Dependency-free hooks utility, tested here for the same reason
// pr-lifecycle-config.test.ts is (outside src/, outside coverage, run with
// bare node by the real hooks).
import { sanitizeSessionId, sessionPrsFilePath, recordOpenedPr, readOpenedPrs } from '../../../hooks/lib/session-prs.mjs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-session-prs-'));
}

describe('sanitizeSessionId', () => {
  it('passes through an already-safe id', () => {
    expect(sanitizeSessionId('abc-123_def.456')).toBe('abc-123_def.456');
  });

  it('replaces unsafe characters', () => {
    expect(sanitizeSessionId('../../etc/passwd')).toBe('.._.._etc_passwd');
  });

  it('falls back to a placeholder for non-string/empty input', () => {
    expect(sanitizeSessionId(undefined)).toBe('unknown-session');
    expect(sanitizeSessionId('')).toBe('unknown-session');
  });
});

describe('sessionPrsFilePath', () => {
  it('joins the scratch dir, sanitized session id, and .jsonl', () => {
    expect(sessionPrsFilePath('abc', '/tmp/x')).toBe(join('/tmp/x', 'gdlc-session-prs', 'abc.jsonl'));
  });
});

describe('recordOpenedPr / readOpenedPrs', () => {
  it('returns [] when nothing has been recorded yet', () => {
    const path = join(tmpDir(), 'session.jsonl');
    expect(readOpenedPrs(path)).toEqual([]);
  });

  it('round-trips a single recorded ref', () => {
    const path = join(tmpDir(), 'nested', 'session.jsonl');
    recordOpenedPr(path, { owner: 'acme', repo: 'widgets', pullNumber: 42 });
    expect(readOpenedPrs(path)).toEqual([{ owner: 'acme', repo: 'widgets', pullNumber: 42 }]);
  });

  it('dedupes repeated records of the same owner/repo/pullNumber, keeping the latest', () => {
    const path = join(tmpDir(), 'session.jsonl');
    recordOpenedPr(path, { owner: 'acme', repo: 'widgets', pullNumber: 42 });
    recordOpenedPr(path, { owner: 'acme', repo: 'widgets', pullNumber: 42 });
    expect(readOpenedPrs(path)).toHaveLength(1);
  });

  it('keeps distinct PRs distinct, including same number in a different repo', () => {
    const path = join(tmpDir(), 'session.jsonl');
    recordOpenedPr(path, { owner: 'acme', repo: 'widgets', pullNumber: 42 });
    recordOpenedPr(path, { owner: 'acme', repo: 'gadgets', pullNumber: 42 });
    expect(readOpenedPrs(path)).toHaveLength(2);
  });

  it('skips a malformed line rather than throwing', () => {
    const path = join(tmpDir(), 'session.jsonl');
    recordOpenedPr(path, { owner: 'acme', repo: 'widgets', pullNumber: 1 });
    const fns = { readFileSync: () => 'not json at all\n{"owner":"acme","repo":"widgets","pullNumber":1}\n' };
    expect(readOpenedPrs(path, fns)).toEqual([{ owner: 'acme', repo: 'widgets', pullNumber: 1 }]);
  });

  it('skips an entry missing a required field', () => {
    const fns = { readFileSync: () => '{"owner":"acme","repo":"widgets"}\n' };
    expect(readOpenedPrs('/irrelevant', fns)).toEqual([]);
  });

  it('recordOpenedPr is a silent no-op on a write failure', () => {
    const fns = {
      writeFileSync: () => {},
      appendFileSync: () => {
        throw new Error('disk full');
      },
    };
    expect(() => recordOpenedPr('/irrelevant/path.jsonl', { owner: 'a', repo: 'b', pullNumber: 1 }, fns)).not.toThrow();
  });

  it('readOpenedPrs returns [] when the file cannot be read', () => {
    const fns = {
      readFileSync: () => {
        throw new Error('permission denied');
      },
    };
    expect(readOpenedPrs('/irrelevant', fns)).toEqual([]);
  });
});
