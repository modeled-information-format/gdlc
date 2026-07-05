import { mkdtempSync, writeFileSync } from 'node:fs';
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
} from '../../../hooks/lib/diagnostic-capture.mjs';

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

describe('detectFailureInFile', () => {
  function tmpFileWith(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'bug-capture-transcript-'));
    const path = join(dir, 'transcript.jsonl');
    writeFileSync(path, content);
    return path;
  }

  it('is a clean no-op when the file does not exist', () => {
    expect(detectFailureInFile('/nonexistent/path/does-not-exist.jsonl')).toEqual({ detected: false });
  });

  it('detects a failure signature present in the file', () => {
    const path = tmpFileWith('{"line":1}\n{"text":"error TS2554: Expected 1 arguments"}\n');
    const result = detectFailureInFile(path);
    expect(result.detected).toBe(true);
    expect(result.signature).toBe('typescript-error');
  });

  it('is clean when the file has no failure signature', () => {
    const path = tmpFileWith('{"line":1}\n{"text":"all clear"}\n');
    expect(detectFailureInFile(path)).toEqual({ detected: false });
  });

  it('only scans the tail when the file exceeds tailBytes', () => {
    const early = 'error TS1: should not be seen\n';
    const filler = 'x'.repeat(100);
    const path = tmpFileWith(`${early}${filler}`);
    expect(detectFailureInFile(path, 50)).toEqual({ detected: false });
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
