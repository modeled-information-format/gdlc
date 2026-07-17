import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mirrors github-sdlc-planning's mcp-server/test/unit/hooks.test.ts pattern
// (issue #185/#187): hook scripts live at the plugin root (../../hooks/), a
// sibling of mcp-server/, testable by spawning them directly with JSON on
// stdin/stdout, the same contract Claude Code itself uses.
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const hooksDir = path.resolve(thisDir, '../../../hooks');

function runHook(
  script: string,
  input: unknown,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): { hookSpecificOutput?: { hookEventName: string; additionalContext?: string; permissionDecision?: string; permissionDecisionReason?: string } } {
  const out = execFileSync('node', [path.join(hooksDir, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd: options.cwd,
    env: options.env,
  });
  return JSON.parse(out);
}

function withPrLifecycleConfig(section: string): { root: string; env: NodeJS.ProcessEnv } {
  const root = mkdtempSync(path.join(tmpdir(), 'pr-lifecycle-hooks-'));
  const configDir = path.join(root, '.config', 'gdlc');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(path.join(configDir, 'config.yml'), section);
  return { root, env: { ...process.env, XDG_CONFIG_HOME: path.join(root, 'no-such-global') } };
}

const PR_INPUT = { tool_name: 'mcp__github-pull-requests__create_pull_request', tool_input: { owner: 'acme', repo: 'widgets' } };

describe('pr-lifecycle-gate.mjs', () => {
  it('is a no-op when no prLifecycle config exists anywhere (fail-closed default)', () => {
    const { root, env } = withPrLifecycleConfig('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op when prLifecycle.enabled is false', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: false\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op when enabled but requireLocalReview is false', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  requireLocalReview: false\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  // gdlc#275: confirmLocalReview defaults to false, so the reminder is now
  // non-blocking (permissionDecision: 'allow') out of the box -- the hard
  // 'ask' stop is opt-in, not the default, since there was previously no
  // way to keep the reminder while dropping the blocking prompt.
  it('allows (non-blocking reminder), naming the configured localReviewer command, when enabled and requireLocalReview defaults true', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('/code-review --fix');
  });

  it('names a custom localReviewer command when configured', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  localReviewer: "/my-org:review"\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('/my-org:review');
  });

  it('asks (hard block) when confirmLocalReview is explicitly true', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  confirmLocalReview: true\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('/code-review --fix');
  });

  it('allows when confirmLocalReview is explicitly false (same as the default)', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  confirmLocalReview: false\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
  });
});

describe('pr-lifecycle-reminder.mjs', () => {
  it('is a no-op when no prLifecycle config exists anywhere', () => {
    const { root, env } = withPrLifecycleConfig('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');
    const result = runHook('pr-lifecycle-reminder.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op when enabled but requireCopilotReview is false', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  requireCopilotReview: false\n');
    const result = runHook('pr-lifecycle-reminder.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('reminds to request Copilot review when enabled and requireCopilotReview defaults true', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const result = runHook('pr-lifecycle-reminder.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Copilot');
  });

  // Copilot review finding: an earlier revision fired regardless of whether
  // create_pull_request itself succeeded.
  it('is a no-op when create_pull_request failed (tool_output.isError), even with the toggle enabled', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const failedInput = { ...PR_INPUT, tool_output: { isError: true, content: [{ type: 'text', text: '{"error":"github_api_error"}' }] } };
    const result = runHook('pr-lifecycle-reminder.mjs', failedInput, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('still reminds when tool_output is a successful JSON string (no isError field)', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const successInput = { ...PR_INPUT, tool_output: JSON.stringify({ number: 42, url: 'https://github.com/acme/widgets/pull/42' }) };
    const result = runHook('pr-lifecycle-reminder.mjs', successInput, { cwd: root, env });
    expect(result.hookSpecificOutput?.additionalContext).toContain('Copilot');
  });
});

// gdlc#275: end-to-end coverage for review-thread-gate.mjs's own decision
// (pr-lifecycle-config.test.ts/review-thread-gate.test.ts already cover the
// config-parsing and pure-lib halves independently). This hook shells out to
// `gh api graphql`, so a fake `gh` executable is put on PATH ahead of the
// real one, always reporting one unresolved thread -- the point of these
// tests is the confirmNewWorkGate branch, not the GraphQL query itself.
const WORKTREE_INPUT = { tool_name: 'Bash', tool_input: { command: 'git checkout -b feat/x' } };

function withFakeGhOnPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const binDir = mkdtempSync(path.join(tmpdir(), 'fake-gh-bin-'));
  const ghPath = path.join(binDir, 'gh');
  writeFileSync(
    ghPath,
    [
      '#!/usr/bin/env node',
      'process.stdout.write(JSON.stringify({',
      '  data: { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } } },',
      '}));',
      '',
    ].join('\n'),
  );
  chmodSync(ghPath, 0o755);
  return { ...env, PATH: `${binDir}${path.delimiter}${env.PATH ?? ''}` };
}

function withOpenedPr(root: string, sessionId: string): void {
  // Matches session-prs.mjs's sessionPrsFilePath/readOpenedPrs contract:
  // sessionPrsFilePath(sessionId) resolves under the REAL os.tmpdir(), not
  // `root` -- there is no env override for its base dir, so the scratch
  // file has to be written to the same real path the hook will read from.
  const scratchDir = path.join(tmpdir(), 'gdlc-session-prs');
  mkdirSync(scratchDir, { recursive: true });
  writeFileSync(path.join(scratchDir, `${sessionId}.jsonl`), `${JSON.stringify({ owner: 'acme', repo: 'widgets', pullNumber: 9 })}\n`);
}

describe('review-thread-gate.mjs', () => {
  it('is a no-op for a non-worktree/branch-creation command, before any config or gh work', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const result = runHook('review-thread-gate.mjs', { tool_name: 'Bash', tool_input: { command: 'npm test' }, session_id: 'irrelevant' }, { cwd: root, env });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op when no session_id is given, even with matching config and an opened PR', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const result = runHook('review-thread-gate.mjs', WORKTREE_INPUT, { cwd: root, env: withFakeGhOnPath(env) });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op when gateNewWorkOnUnresolvedThreads is false', () => {
    const sessionId = `no-gate-${Date.now()}`;
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  gateNewWorkOnUnresolvedThreads: false\n');
    withOpenedPr(root, sessionId);
    const result = runHook(
      'review-thread-gate.mjs',
      { ...WORKTREE_INPUT, session_id: sessionId },
      { cwd: root, env: withFakeGhOnPath(env) },
    );
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  // gdlc#275: confirmNewWorkGate defaults to false, so flagging an
  // unresolved-thread PR is now non-blocking (permissionDecision: 'allow')
  // out of the box, same default-flip as pr-lifecycle-gate.mjs's
  // confirmLocalReview.
  it('allows (non-blocking reminder) naming the flagged PR when confirmNewWorkGate defaults false', () => {
    const sessionId = `default-${Date.now()}`;
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    withOpenedPr(root, sessionId);
    const result = runHook(
      'review-thread-gate.mjs',
      { ...WORKTREE_INPUT, session_id: sessionId },
      { cwd: root, env: withFakeGhOnPath(env) },
    );
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('allow');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('acme/widgets#9');
  });

  it('asks (hard block) when confirmNewWorkGate is explicitly true', () => {
    const sessionId = `confirm-${Date.now()}`;
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  confirmNewWorkGate: true\n');
    withOpenedPr(root, sessionId);
    const result = runHook(
      'review-thread-gate.mjs',
      { ...WORKTREE_INPUT, session_id: sessionId },
      { cwd: root, env: withFakeGhOnPath(env) },
    );
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('acme/widgets#9');
  });
});
