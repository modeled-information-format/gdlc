import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

  it('asks, naming the configured localReviewer command, when enabled and requireLocalReview defaults true', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('/code-review:code-review --fix');
  });

  it('names a custom localReviewer command when configured', () => {
    const { root, env } = withPrLifecycleConfig('prLifecycle:\n  enabled: true\n  localReviewer: "/my-org:review"\n');
    const result = runHook('pr-lifecycle-gate.mjs', PR_INPUT, { cwd: root, env });
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('/my-org:review');
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
