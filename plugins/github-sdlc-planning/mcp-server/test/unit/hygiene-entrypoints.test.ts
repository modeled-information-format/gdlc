import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Same rationale as hooks.test.ts: the hook scripts are plain Node scripts
// (JSON on stdin, JSON on stdout) invoked directly by Claude Code, so
// they're testable by spawning them the same way. Unlike hygiene-check-hook.test.ts
// and hygiene-scratch-aggregate.test.ts (which test the dependency-free
// lib/*.mjs functions directly), these tests exercise the entrypoint
// scripts themselves -- specifically their never-non-zero-exit contract,
// which is a property of the entrypoint's own top-level error handling,
// not of any lib function.
const hooksDir = path.resolve(fileURLToPath(import.meta.url), '../../../../hooks');

function runHook(script: string, input: string): { text: string; status: number | null } {
  try {
    const out = execFileSync('node', [path.join(hooksDir, script)], { input, encoding: 'utf8' });
    return { text: out, status: 0 };
  } catch (error) {
    const err = error as { stdout?: string; status?: number | null };
    return { text: err.stdout ?? '', status: err.status ?? null };
  }
}

describe('hygiene-check.mjs entrypoint', () => {
  it('exits 0 with an empty object for a tool it does not track', () => {
    const result = runHook('hygiene-check.mjs', JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x' } }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never exits non-zero on a null-shaped stdin payload, matching the entrypoint\'s documented never-non-zero-exit contract', () => {
    const result = runHook('hygiene-check.mjs', 'null');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never exits non-zero on malformed (non-JSON) stdin', () => {
    const result = runHook('hygiene-check.mjs', 'not json at all');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never emits a decision:"block" field or any output beyond hookSpecificOutput, even for a recognized touch', () => {
    // gh issue view triggers no check (view is not a transition) but IS a
    // recognized touch, exercising the full extractTouch -> runHygieneChecks
    // -> emit path end to end without needing a real `gh api graphql` call.
    const result = runHook(
      'hygiene-check.mjs',
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh issue view 42' }, cwd: '/tmp' }),
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.text);
    expect(parsed.decision).toBeUndefined();
    expect(Object.keys(parsed).every((k) => k === 'hookSpecificOutput')).toBe(true);
  });

  it('does not shell out to git for an unrelated Bash command (Copilot review finding on PR #173) -- only a gh issue|pr command pays for the owner/repo fallback lookup', () => {
    // A fake `git` on PATH that records whether it was invoked at all,
    // shadowing the real one. Exits 1 (as a real `git remote get-url`
    // would outside a repo) so behavior is identical either way -- this
    // test only ever asserts on the marker file, never on the hook's
    // output shape (already covered by the other tests in this file).
    const fakeBinDir = mkdtempSync(path.join(tmpdir(), 'gdlc-fake-git-bin-'));
    const markerFile = path.join(fakeBinDir, 'git-was-invoked');
    const fakeGitPath = path.join(fakeBinDir, 'git');
    writeFileSync(fakeGitPath, `#!/bin/sh\ntouch "${markerFile}"\nexit 1\n`);
    chmodSync(fakeGitPath, 0o755);

    try {
      execFileSync('node', [path.join(hooksDir, 'hygiene-check.mjs')], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: '/tmp' }),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` },
      });
      expect(existsSync(markerFile)).toBe(false);

      execFileSync('node', [path.join(hooksDir, 'hygiene-check.mjs')], {
        input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'gh issue view 42' }, cwd: '/tmp' }),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH ?? ''}` },
      });
      expect(existsSync(markerFile)).toBe(true);
    } finally {
      rmSync(fakeBinDir, { recursive: true, force: true });
    }
  });
});

describe('hygiene-aggregate.mjs entrypoint', () => {
  it('exits 0 with an empty object when session_id is missing', () => {
    const result = runHook('hygiene-aggregate.mjs', JSON.stringify({ cwd: '/tmp' }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never exits non-zero on a null-shaped stdin payload -- the direct regression test for the crash found in review (a bare unwrapped main() call previously let this propagate as an uncaught TypeError and exit code 1)', () => {
    const result = runHook('hygiene-aggregate.mjs', 'null');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never exits non-zero on malformed (non-JSON) stdin', () => {
    const result = runHook('hygiene-aggregate.mjs', 'not json at all');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });

  it('never exits non-zero for a session with no scratch file at all', () => {
    const result = runHook('hygiene-aggregate.mjs', JSON.stringify({ session_id: `no-such-session-${Date.now()}` }));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.text)).toEqual({});
  });
});
