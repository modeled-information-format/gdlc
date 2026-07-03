import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// AC-8/AC-9: the hook scripts live at the plugin root (../../hooks/), a
// sibling of mcp-server/, not inside this package. They're plain Node
// scripts (JSON on stdin, JSON on stdout) so they're testable by spawning
// them directly, the same contract Claude Code itself uses to invoke them.
const hooksDir = path.resolve(fileURLToPath(import.meta.url), '../../../../hooks');

function runHook(script: string, input: unknown): { hookSpecificOutput?: { hookEventName: string; additionalContext?: string; permissionDecision?: string; permissionDecisionReason?: string } } {
  const out = execFileSync('node', [path.join(hooksDir, script)], { input: JSON.stringify(input), encoding: 'utf8' });
  return JSON.parse(out);
}

describe('validate-mif.mjs (AC-9)', () => {
  it('emits a correction instruction when the tool output body is not MIF-conformant', () => {
    const result = runHook('validate-mif.mjs', {
      tool_name: 'mcp__github-sdlc-planning__create_issue',
      tool_output: JSON.stringify({ number: 1, body: 'plain body, no frontmatter' }),
    });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
    expect(result.hookSpecificOutput?.additionalContext).toContain('MIF frontmatter block');
  });

  it('is a no-op when the body already carries a valid MIF block', () => {
    const result = runHook('validate-mif.mjs', {
      tool_name: 'mcp__github-sdlc-planning__create_issue',
      tool_output: JSON.stringify({
        number: 1,
        body: '<!-- mif-id: urn:mif:concept:acme:x -->\n<!-- mif-type: Task -->\n<!-- mif-ns: acme -->\nBody',
      }),
    });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('is a no-op for tools it does not care about', () => {
    const result = runHook('validate-mif.mjs', { tool_name: 'Bash', tool_output: 'ls output' });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('handles the MCP content-array tool_output shape too', () => {
    const result = runHook('validate-mif.mjs', {
      tool_name: 'mcp__github-sdlc-planning__create_issue',
      tool_output: { content: [{ type: 'text', text: JSON.stringify({ number: 1, body: 'plain body' }) }] },
    });
    expect(result.hookSpecificOutput?.additionalContext).toContain('MIF frontmatter block');
  });
});

describe('confirm-mutation.mjs', () => {
  it('asks for confirmation before a board-mutating tool call, with a legible reason', () => {
    const result = runHook('confirm-mutation.mjs', {
      tool_name: 'mcp__github-sdlc-planning__create_issue',
      tool_input: { owner: 'acme', repo: 'widgets', title: 'Ship it' },
    });
    expect(result.hookSpecificOutput?.hookEventName).toBe('PreToolUse');
    expect(result.hookSpecificOutput?.permissionDecision).toBe('ask');
    expect(result.hookSpecificOutput?.permissionDecisionReason).toContain('Ship it');
  });

  it('is a no-op for a non-mutating tool', () => {
    const result = runHook('confirm-mutation.mjs', { tool_name: 'Bash', tool_input: { command: 'ls' } });
    expect(result.hookSpecificOutput).toBeUndefined();
  });
});

describe('session-start.mjs', () => {
  it('degrades silently (empty output) outside a git repository', () => {
    const result = runHook('session-start.mjs', { cwd: '/tmp' });
    expect(result).toEqual({});
  });
});
