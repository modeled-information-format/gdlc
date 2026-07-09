import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Same rationale as pack-toggles.test.ts: the hooks-pack's detection logic is a
// dependency-free hooks utility, tested here through the plugin's single vitest
// rig, but intentionally outside src/ (and outside the coverage include) because
// hooks run it with bare node, not through the bundled server.
import {
  FAILURE_SIGNATURES,
  detectFailure,
  detectFailureInFile,
  extractOutputText,
  buildAdditionalContext,
  stripPriorDiagnosticBlocks,
  computeScanWindow,
  readLastOffset,
  writeLastOffset,
  defaultStatePath,
} from '../../../hooks/lib/diagnostic-capture.mjs';

/** A fresh, isolated state directory per test file run so `detectFailureInFile`'s
 * high-water-mark bookkeeping never touches the real os.tmpdir() or leaks
 * state between unrelated test cases. */
function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), 'bug-capture-diag-state-'));
}

describe('detectFailure', () => {
  it('is clean for ordinary output', () => {
    expect(detectFailure('All good, build complete.')).toEqual({ detected: false });
  });

  it('is clean for empty/nullish input', () => {
    expect(detectFailure('')).toEqual({ detected: false });
    expect(detectFailure(undefined)).toEqual({ detected: false });
    expect(detectFailure(null)).toEqual({ detected: false });
  });

  it('detects a vitest/jest-style test failure', () => {
    const result = detectFailure(' FAIL  test/unit/thing.test.ts\n  x thing broke');
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('test-failure');
    expect(result.excerpt).toContain('FAIL');
  });

  it('detects a TypeScript compiler error', () => {
    const result = detectFailure("src/index.ts(10,5): error TS2322: Type 'string' is not assignable.");
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('typescript-error');
  });

  it('detects an eslint-style line:col error marker', () => {
    const result = detectFailure('/repo/src/index.ts\n  12:3  error  Unexpected any  @typescript-eslint/no-explicit-any');
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('lint-error');
  });

  it('detects a non-zero exit code mention', () => {
    const result = detectFailure('Command failed with exit code 1');
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('nonzero-exit');
  });

  it('does not treat "exit code 0" as a failure on its own', () => {
    expect(detectFailure('Command completed with exit code 0')).toEqual({ detected: false });
  });

  it('detects a generic "Error:" marker as a fallback', () => {
    const result = detectFailure('Error: something went wrong');
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('generic-error');
  });

  it('does not treat "FAIL" appearing mid-sentence as a test failure', () => {
    expect(detectFailure('This test suite does not FAIL under normal conditions')).toEqual({ detected: false });
  });

  it('accepts the known generic-error tradeoff: line-start "Error:" in help-style text still triggers', () => {
    // Documents a deliberate, accepted limitation (see FAILURE_SIGNATURES'
    // doc comment): a language-agnostic, dependency-free heuristic cannot
    // distinguish a real stderr error line from --help text that happens
    // to format an option description starting with "Error:" on its own
    // line. Anchoring to line start (this diff) already rejects the
    // mid-sentence case; this residual case is accepted, not a bug.
    const result = detectFailure('Usage: mytool [options]\nError: handling mode configures failure behavior');
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('generic-error');
  });

  it('returns a bounded excerpt around the match, not the whole input', () => {
    const noise = 'x'.repeat(1000);
    const result = detectFailure(`${noise}\nError: boom\n${noise}`);
    expect(result.detected).toBe(true);
    expect(result.excerpt.length).toBeLessThan(1000);
    expect(result.excerpt).toContain('Error: boom');
  });

  it('exposes the known signature names for documentation/consistency', () => {
    expect(FAILURE_SIGNATURES.map((s) => s.name)).toEqual([
      'test-failure',
      'typescript-error',
      'lint-error',
      'nonzero-exit',
      'generic-error',
    ]);
  });
});

describe('extractOutputText', () => {
  it('passes a string straight through', () => {
    expect(extractOutputText('FAIL everything')).toBe('FAIL everything');
  });

  it('joins stdout/stderr/output fields from an object shape', () => {
    expect(extractOutputText({ output: 'a', stdout: 'b', stderr: 'c' })).toBe('a\nb\nc');
  });

  it('ignores non-string fields and unrelated keys', () => {
    expect(extractOutputText({ exitCode: 1, stdout: 'ok' })).toBe('ok');
  });

  it('is empty for nullish or non-object/non-string input', () => {
    expect(extractOutputText(null)).toBe('');
    expect(extractOutputText(undefined)).toBe('');
    expect(extractOutputText(42)).toBe('');
  });
});

describe('stripPriorDiagnosticBlocks', () => {
  it('removes a whole previously-injected notification block, leaving no matchable failure signature behind', () => {
    const injected = buildAdditionalContext({ detected: true, signature: 'nonzero-exit', excerpt: 'Command failed with exit code 1' });
    const stripped = stripPriorDiagnosticBlocks(injected);
    expect(stripped).not.toContain('exit code 1');
    expect(stripped).not.toContain("hooks-pack's diagnostic-capture detected");
    expect(detectFailure(stripped)).toEqual({ detected: false });
  });

  it('leaves ordinary text untouched', () => {
    expect(stripPriorDiagnosticBlocks('All good, build complete.')).toBe('All good, build complete.');
  });

  it('strips an injected block while leaving a genuinely new failure elsewhere in the text visible', () => {
    const injected = buildAdditionalContext({ detected: true, signature: 'nonzero-exit', excerpt: 'Command failed with exit code 1' });
    const text = `${injected}\n\nsrc/index.ts(10,5): error TS2322: Type 'string' is not assignable.`;
    const stripped = stripPriorDiagnosticBlocks(text);
    expect(stripped).not.toContain("hooks-pack's diagnostic-capture detected");
    expect(detectFailure(stripped)).toMatchObject({ detected: true, signature: 'typescript-error' });
  });

  it('is a no-op for nullish input', () => {
    expect(stripPriorDiagnosticBlocks(null)).toBe('');
    expect(stripPriorDiagnosticBlocks(undefined)).toBe('');
  });
});

describe('computeScanWindow', () => {
  it('scans the tail window when there is no prior offset (first scan)', () => {
    expect(computeScanWindow(1000, null, 200)).toEqual({ start: 800, end: 1000 });
  });

  it('scans only from the prior offset when it is within the tail window', () => {
    expect(computeScanWindow(1000, 950, 200)).toEqual({ start: 950, end: 1000 });
  });

  it('caps the scan to tailBytes even when the prior offset is far behind', () => {
    expect(computeScanWindow(1000, 10, 200)).toEqual({ start: 800, end: 1000 });
  });

  it('produces an empty window when nothing has changed since the last scan', () => {
    expect(computeScanWindow(1000, 1000, 200)).toEqual({ start: 1000, end: 1000 });
  });

  it('falls back to a fresh tail window when the recorded offset is beyond the current size (truncated/rotated file)', () => {
    expect(computeScanWindow(100, 500, 200)).toEqual({ start: 0, end: 100 });
  });

  it('treats a malformed offset the same as no offset at all', () => {
    expect(computeScanWindow(1000, -5, 200)).toEqual({ start: 800, end: 1000 });
    expect(computeScanWindow(1000, Number.NaN, 200)).toEqual({ start: 800, end: 1000 });
    expect(computeScanWindow(1000, undefined, 200)).toEqual({ start: 800, end: 1000 });
  });
});

describe('offset state (readLastOffset / writeLastOffset / defaultStatePath)', () => {
  it('is null when nothing has been recorded yet', () => {
    const stateDir = freshStateDir();
    expect(readLastOffset('/some/transcript.jsonl', stateDir)).toBeNull();
  });

  it('round-trips a written offset', () => {
    const stateDir = freshStateDir();
    writeLastOffset('/some/transcript.jsonl', 4242, stateDir);
    expect(readLastOffset('/some/transcript.jsonl', stateDir)).toBe(4242);
  });

  it('keys state independently per transcript path', () => {
    const stateDir = freshStateDir();
    writeLastOffset('/a/transcript.jsonl', 10, stateDir);
    writeLastOffset('/b/transcript.jsonl', 20, stateDir);
    expect(readLastOffset('/a/transcript.jsonl', stateDir)).toBe(10);
    expect(readLastOffset('/b/transcript.jsonl', stateDir)).toBe(20);
  });

  it('is null (fail-soft) when the state file contains malformed JSON', () => {
    const stateDir = freshStateDir();
    writeFileSync(defaultStatePath('/some/transcript.jsonl', stateDir), 'not json');
    expect(readLastOffset('/some/transcript.jsonl', stateDir)).toBeNull();
  });
});

describe('detectFailureInFile', () => {
  function tmpFileWith(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'bug-capture-transcript-'));
    const path = join(dir, 'transcript.jsonl');
    writeFileSync(path, content);
    return path;
  }

  it('is a clean no-op when the file does not exist', () => {
    expect(detectFailureInFile('/nonexistent/path/does-not-exist.jsonl', 20000, freshStateDir())).toEqual({ detected: false });
  });

  it('detects a failure signature present in the file', () => {
    const path = tmpFileWith('{"line":1}\n{"text":"error TS2554: Expected 1 arguments"}\n');
    const result = detectFailureInFile(path, 20000, freshStateDir());
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('typescript-error');
  });

  it('is clean when the file has no failure signature', () => {
    const path = tmpFileWith('{"line":1}\n{"text":"all clear"}\n');
    expect(detectFailureInFile(path, 20000, freshStateDir())).toEqual({ detected: false });
  });

  it('only scans the tail when the file exceeds tailBytes', () => {
    const early = 'error TS1: should not be seen\n';
    const filler = 'x'.repeat(100);
    const path = tmpFileWith(`${early}${filler}`);
    expect(detectFailureInFile(path, 50, freshStateDir())).toEqual({ detected: false });
  });

  it('issue #146: does not re-detect the same failure on a second scan with no new content', () => {
    const path = tmpFileWith('{"text":"error TS2554: Expected 1 arguments"}\n');
    const stateDir = freshStateDir();
    const first = detectFailureInFile(path, 20000, stateDir);
    expect(first.detected).toBe(true);
    const second = detectFailureInFile(path, 20000, stateDir);
    expect(second).toEqual({ detected: false });
  });

  it('issue #146: still detects a genuinely new failure appended after a prior clean scan', () => {
    const path = tmpFileWith('{"text":"all clear"}\n');
    const stateDir = freshStateDir();
    expect(detectFailureInFile(path, 20000, stateDir)).toEqual({ detected: false });
    appendFileSync(path, '{"text":"error TS9999: new failure"}\n');
    const result = detectFailureInFile(path, 20000, stateDir);
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('typescript-error');
  });

  it('issue #146: does not re-match its own previously-injected notification appended to the transcript', () => {
    const path = tmpFileWith('{"text":"Command failed with exit code 1"}\n');
    const stateDir = freshStateDir();
    const first = detectFailureInFile(path, 20000, stateDir);
    expect(first.detected).toBe(true);
    expect(first.signature).toBe('nonzero-exit');

    // Simulate the harness recording this hook's own additionalContext back
    // into the transcript, the way a real Stop-hook response would appear —
    // it quotes the original excerpt (and therefore "exit code 1") verbatim.
    const injected = buildAdditionalContext(first);
    appendFileSync(path, `\n${JSON.stringify({ additionalContext: injected })}\n`);

    const second = detectFailureInFile(path, 20000, stateDir);
    expect(second).toEqual({ detected: false });
  });
});

describe('buildAdditionalContext', () => {
  it('names the signature, includes the excerpt, and points at file-bug', () => {
    const text = buildAdditionalContext({ detected: true, signature: 'generic-error', excerpt: 'Error: boom' });
    expect(text).toContain('generic-error');
    expect(text).toContain('Error: boom');
    expect(text).toContain('file-bug skill');
    expect(text).toContain('no issue has been filed');
  });
});
