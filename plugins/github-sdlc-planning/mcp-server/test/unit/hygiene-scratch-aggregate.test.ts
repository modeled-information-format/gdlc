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
  it('scopes the path under a gdlc-hygiene-scratch directory keyed by session id, namespaced per physical copy', () => {
    const path = scratchFilePath('sess-1', '/tmp/base');
    expect(path).toMatch(/^\/tmp\/base\/gdlc-hygiene-scratch\/sess-1-[0-9a-f]{12}\.jsonl$/);
  });

  it('is deterministic for the same copy -- calling it twice yields the identical path', () => {
    expect(scratchFilePath('sess-1', '/tmp/base')).toBe(scratchFilePath('sess-1', '/tmp/base'));
  });

  it('yields a DIFFERENT path for the same session id across two different physical copies of this file (Copilot review finding on PR #173) -- otherwise two plugins active in the same session, or a plugin copy plus a project-level registration, collide on one shared scratch file', async () => {
    const siblingModule = await import('../../../../github-pull-requests/hooks/lib/hygiene-scratch.mjs');
    const canonicalPath = scratchFilePath('shared-session-id', '/tmp/base');
    const siblingPath = siblingModule.scratchFilePath('shared-session-id', '/tmp/base');
    expect(siblingPath).not.toBe(canonicalPath);
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
  it('returns null for no entries', async () => {
    expect(await buildConsolidatedContext([])).toBeNull();
    expect(await buildConsolidatedContext(undefined as unknown as unknown[])).toBeNull();
  });

  it('returns null when every entry has zero findings', async () => {
    expect(await buildConsolidatedContext([{ findings: [] }, { findings: [] }])).toBeNull();
  });

  it('consolidates findings across multiple touches into one message', async () => {
    const entries = [
      { findings: ['a/b#1: gap one'] },
      { findings: [] },
      { findings: ['a/b#2: gap two'] },
    ];
    const text = await buildConsolidatedContext(entries);
    expect(text).toContain('3 GitHub touches this turn');
    expect(text).toContain('- a/b#1: gap one');
    expect(text).toContain('- a/b#2: gap two');
  });

  it('de-duplicates an identical finding recurring across multiple touches', async () => {
    const entries = [{ findings: ['same gap'] }, { findings: ['same gap'] }];
    const text = await buildConsolidatedContext(entries);
    expect(text?.split('same gap')).toHaveLength(2); // appears exactly once
  });

  it('uses singular phrasing for exactly one touch', async () => {
    const text = await buildConsolidatedContext([{ findings: ['only gap'] }]);
    expect(text).toContain('1 GitHub touch this turn');
  });
});

// Issue #278: a lifecycle-comment finding recorded at PostToolUse time can
// be stale by Stop time -- a later touch in the SAME turn may have already
// posted the comment. buildConsolidatedContext must re-validate this one
// finding kind against the turn's final transcript state rather than
// replaying every scratch entry verbatim.
describe('buildConsolidatedContext: issue #278 stale-finding re-validation', () => {
  const RESOLVED = () => ({ resolved: true, found: true });
  const STILL_MISSING = () => ({ resolved: true, found: false });
  const LIFECYCLE_FINDING = 'acme/widgets#9: transitioned with no lifecycle comment found this turn -- consider posting one.';

  it('drops a lifecycle-comment finding when a later same-turn action already resolved it', async () => {
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', RESOLVED);
    expect(text).toBeNull();
  });

  it('keeps a lifecycle-comment finding when the scan confirms it is still unresolved', async () => {
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', STILL_MISSING);
    expect(text).toContain(LIFECYCLE_FINDING);
  });

  it('passes the identity parsed from the finding text to scanFn', async () => {
    let capturedRef;
    const scanFn = (_path, ref) => {
      capturedRef = ref;
      return { resolved: true, found: true };
    };
    await buildConsolidatedContext(
      [{ findings: ['acme/widgets#42: transitioned with no lifecycle comment found this turn -- consider posting one.'] }],
      '/fake/transcript.jsonl',
      scanFn,
    );
    expect(capturedRef).toEqual({ owner: 'acme', repo: 'widgets', number: 42 });
  });

  it('never re-checks a non-lifecycle-comment finding (passes through unconditionally)', async () => {
    let called = false;
    const scanFn = () => {
      called = true;
      return { resolved: true, found: true };
    };
    const otherFinding = 'acme/widgets#9: PR references it but board Status is still "In Review" -- consider moving it to In Review.';
    const text = await buildConsolidatedContext([{ findings: [otherFinding] }], '/fake/transcript.jsonl', scanFn);
    expect(text).toContain(otherFinding);
    expect(called).toBe(false);
  });

  it('reports null only when every finding in the turn turns out already resolved', async () => {
    const entries = [
      {
        findings: [
          'acme/widgets#1: transitioned with no lifecycle comment found this turn -- consider posting one.',
          'acme/widgets#2: transitioned with no lifecycle comment found this turn -- consider posting one.',
        ],
      },
    ];
    const text = await buildConsolidatedContext(entries, '/fake/transcript.jsonl', RESOLVED);
    expect(text).toBeNull();
  });

  it('keeps whichever findings remain unresolved while dropping the resolved ones in the same turn', async () => {
    const resolved = 'acme/widgets#1: transitioned with no lifecycle comment found this turn -- consider posting one.';
    const stillOpen = 'acme/widgets#2: transitioned with no lifecycle comment found this turn -- consider posting one.';
    const scanFn = (_path, ref) => ({ resolved: true, found: ref.number === 1 });
    const text = await buildConsolidatedContext([{ findings: [resolved, stillOpen] }], '/fake/transcript.jsonl', scanFn);
    expect(text).not.toContain(resolved);
    expect(text).toContain(stillOpen);
  });

  it('does not re-check when scanFn reports unresolved (e.g. unreadable transcript) and no runGraphQL is given -- fails open, keeps the finding', async () => {
    const scanFn = () => ({ resolved: false });
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', scanFn);
    expect(text).toContain(LIFECYCLE_FINDING);
  });
});

// gdlc#324: a comment posted by a background subagent can never appear in
// the PARENT transcript scanFn reads, no matter how many times this
// aggregator re-scans it -- so buildConsolidatedContext also needs a live
// GraphQL fallback, the same one checkLifecycleComment itself uses at
// PostToolUse time, or the end-of-turn reminder would report the same
// "gap" forever even after the comment genuinely exists on GitHub.
describe('buildConsolidatedContext: gdlc#324 live GraphQL fallback', () => {
  const STILL_MISSING = () => ({ resolved: true, found: false });
  const UNRESOLVED = () => ({ resolved: false });
  const LIFECYCLE_FINDING = 'acme/widgets#9: transitioned with no lifecycle comment found this turn -- consider posting one.';

  it('drops the finding when the transcript re-scan finds nothing but a live GraphQL check confirms a recent comment (the subagent case)', async () => {
    const runGraphQL = async () => ({
      repository: { issue: { comments: { nodes: [{ createdAt: new Date().toISOString() }] } } },
    });
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', STILL_MISSING, runGraphQL);
    expect(text).toBeNull();
  });

  it('also tries the live fallback when the transcript scan itself is unresolved (e.g. unreadable transcript)', async () => {
    const runGraphQL = async () => ({
      repository: { issue: { comments: { nodes: [{ createdAt: new Date().toISOString() }] } } },
    });
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', UNRESOLVED, runGraphQL);
    expect(text).toBeNull();
  });

  it('keeps the finding when neither the transcript scan nor the live fallback can confirm a comment', async () => {
    const runGraphQL = async () => ({ repository: { issue: { comments: { nodes: [] } } } });
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', STILL_MISSING, runGraphQL);
    expect(text).toContain(LIFECYCLE_FINDING);
  });

  it('keeps the finding when the live fallback itself throws (fails open, never suppresses on an error)', async () => {
    const runGraphQL = async () => {
      throw new Error('rate limited');
    };
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', STILL_MISSING, runGraphQL);
    expect(text).toContain(LIFECYCLE_FINDING);
  });

  it('never calls the live fallback once the transcript re-scan alone already resolved the finding (no wasted network call)', async () => {
    const RESOLVED = () => ({ resolved: true, found: true });
    const runGraphQL = async () => {
      throw new Error('should never be called');
    };
    const text = await buildConsolidatedContext([{ findings: [LIFECYCLE_FINDING] }], '/fake/transcript.jsonl', RESOLVED, runGraphQL);
    expect(text).toBeNull();
  });
});
