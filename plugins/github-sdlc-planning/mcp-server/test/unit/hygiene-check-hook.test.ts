import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Same rationale as in-progress-hook.test.ts: the hygiene-check hook's logic
// is a dependency-free hooks utility, tested here through the plugin's
// single vitest rig, but intentionally outside src/ (and outside the
// coverage include) because the hook runs it with bare node, not through
// the bundled server.
import {
  extractTouch,
  checkStatusProgression,
  scanTranscriptForComment,
  checkLifecycleComment,
  checkSubIssueLinkage,
  runHygieneChecks,
  buildAdditionalContext,
} from '../../../hooks/lib/hygiene-check.mjs';

describe('extractTouch', () => {
  it('returns null for an irrelevant Bash command', () => {
    expect(extractTouch({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }, null)).toBeNull();
  });

  it('returns null for an irrelevant MCP tool', () => {
    expect(extractTouch({ tool_name: 'mcp__github-sdlc-planning__list_milestones', tool_input: {} }, null)).toBeNull();
  });

  it('recognizes a gh issue command and extracts the issue number', () => {
    const touch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue view 42' } }, { owner: 'acme', repo: 'widgets' });
    expect(touch).toEqual({ surface: 'gh-cli', action: 'gh_command', owner: 'acme', repo: 'widgets', number: 42, closing: false, closesIssues: [] });
  });

  it('recognizes a gh pr create command and extracts closing-keyword issue refs from --body', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh pr create --title "x" --body "Closes #42 and fixes #7"' } },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch.action).toBe('create_pull_request');
    expect(touch.closesIssues).toEqual(
      expect.arrayContaining([
        { owner: 'acme', repo: 'widgets', number: 42 },
        { owner: 'acme', repo: 'widgets', number: 7 },
      ]),
    );
  });

  it('recognizes a gh issue create command as create_issue, extracting the new number from stdout', () => {
    const touch = extractTouch(
      {
        tool_name: 'Bash',
        tool_input: { command: 'gh issue create --title "Epic X" --body "stuff"' },
        tool_output: { stdout: 'https://github.com/acme/widgets/issues/123\n' },
      },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toEqual({ surface: 'gh-cli', action: 'create_issue', owner: 'acme', repo: 'widgets', number: 123, closing: false, closesIssues: [] });
  });

  it('returns a null number for gh issue create when stdout carries no parseable URL', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh issue create --title "x" --body "y"' }, tool_output: {} },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ action: 'create_issue', number: null });
  });

  it('recognizes gh issue edit and gh pr close as update_issue with the positional number', () => {
    const edit = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue edit 42 --add-label bug' } }, { owner: 'acme', repo: 'widgets' });
    expect(edit).toEqual({ surface: 'gh-cli', action: 'update_issue', owner: 'acme', repo: 'widgets', number: 42, closing: false, closesIssues: [] });

    const close = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh pr close 7' } }, { owner: 'acme', repo: 'widgets' });
    expect(close).toMatchObject({ action: 'update_issue', number: 7 });
  });

  it('does not mistake a digit in the title/body for the positional target number on edit/close', () => {
    const touch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue edit 5 --body "deploy to 2 servers"' } }, { owner: 'acme', repo: 'widgets' });
    expect(touch).toMatchObject({ number: 5 });
  });

  it('does not mistake a digit in the title/body for the PR number on gh pr create -- the number comes from stdout, not the command text', () => {
    const touch = extractTouch(
      {
        tool_name: 'Bash',
        tool_input: { command: 'gh pr create --title "Deploy 2 servers" --body "Closes #10"' },
        tool_output: { stdout: 'https://github.com/acme/widgets/pull/99\n' },
      },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ action: 'create_pull_request', number: 99 });
    expect(touch.closesIssues).toEqual([{ owner: 'acme', repo: 'widgets', number: 10 }]);
  });

  it('recognizes the plugin-scoped create_issue MCP tool and falls back to tool_output for the new number', () => {
    const touch = extractTouch(
      {
        tool_name: 'mcp__github-sdlc-planning__create_issue',
        tool_input: { owner: 'acme', repo: 'widgets', title: 't', body: 'b', mif: { id: 'x', type: 'Epic', namespace: 'ns' } },
        tool_output: { number: 99, body: '<!-- mif-type: Epic -->' },
      },
      null,
    );
    expect(touch).toMatchObject({ surface: 'plugin-mcp', action: 'create_issue', owner: 'acme', repo: 'widgets', number: 99 });
  });

  it('recognizes the generic github MCP server distinctly from a plugin-scoped tool', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 5, body: 'hi' } },
      null,
    );
    expect(touch).toMatchObject({ surface: 'generic-github-mcp', action: 'add_issue_comment', number: 5 });
  });

  it('extracts closing-keyword refs from a create_pull_request MCP call body', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-pull-requests__create_pull_request', tool_input: { owner: 'acme', repo: 'widgets', body: 'Closes #12' } },
      null,
    );
    expect(touch.closesIssues).toEqual([{ owner: 'acme', repo: 'widgets', number: 12 }]);
  });

  it('unwraps the MCP content-array tool_output shape to read number/body, not just a flat object', () => {
    const touch = extractTouch(
      {
        tool_name: 'mcp__github-sdlc-planning__create_issue',
        tool_input: { owner: 'acme', repo: 'widgets', title: 't', body: 'b', mif: { id: 'x', type: 'Epic', namespace: 'ns' } },
        tool_output: { content: [{ type: 'text', text: JSON.stringify({ number: 77, body: '<!-- mif-type: Epic -->' }) }] },
      },
      null,
    );
    expect(touch).toMatchObject({ action: 'create_issue', number: 77 });
  });

  it('yields a null number (never a guess) when tool_output is an unrecognized shape', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__create_issue', tool_input: { owner: 'acme', repo: 'widgets' }, tool_output: 'not json at all' },
      null,
    );
    expect(touch).toMatchObject({ action: 'create_issue', number: null });
  });

  it('reclassifies the generic github MCP server\'s issue_write onto create_issue/update_issue by its method field', () => {
    const created = extractTouch(
      { tool_name: 'mcp__github__issue_write', tool_input: { method: 'create', owner: 'acme', repo: 'widgets' }, tool_output: { number: 5 } },
      null,
    );
    expect(created).toMatchObject({ action: 'create_issue', number: 5, closing: false });

    const updated = extractTouch(
      { tool_name: 'mcp__github__issue_write', tool_input: { method: 'update', owner: 'acme', repo: 'widgets', issue_number: 6 } },
      null,
    );
    expect(updated).toMatchObject({ action: 'update_issue', number: 6, closing: false });

    const closed = extractTouch(
      { tool_name: 'mcp__github__issue_write', tool_input: { method: 'update', owner: 'acme', repo: 'widgets', issue_number: 6, state: 'closed' } },
      null,
    );
    expect(closed).toMatchObject({ action: 'update_issue', number: 6, closing: true });
  });

  it('is never miscategorized as a comment action -- issue_write has no comment-posting semantics', () => {
    // Confirms the fix for the finding that issue_write was previously in
    // COMMENT_ACTIONS: an issue_write touch on an Epic with zero sub-issues
    // must still be recognized as create_issue/update_issue, not silently
    // treated as "this looked like a comment, nothing to check."
    const touch = extractTouch(
      { tool_name: 'mcp__github__issue_write', tool_input: { method: 'update', owner: 'acme', repo: 'widgets', issue_number: 1 } },
      null,
    );
    expect(touch.action).not.toBe('add_issue_comment');
    expect(touch.action).toBe('update_issue');
  });
});

describe('checkStatusProgression', () => {
  const ref = { owner: 'acme', repo: 'widgets', number: 42 };

  it('resolves with no findings when the touch closes no issues', async () => {
    const result = await checkStatusProgression({ closesIssues: [] }, async () => ({}));
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('flags an issue whose Status is not yet In Review', async () => {
    const runGraphQL = async () => ({
      repository: { issue: { projectItems: { nodes: [{ fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] } }] } } },
    });
    const result = await checkStatusProgression({ closesIssues: [ref] }, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#42');
    expect(result.findings[0]).toContain('In Progress');
  });

  it('does not flag Status values ADR-0003 already owns or that are already In Review', async () => {
    for (const status of ['In Review', 'Done', 'Blocked']) {
      const runGraphQL = async () => ({
        repository: { issue: { projectItems: { nodes: [{ fieldValues: { nodes: [{ name: status, field: { name: 'Status' } }] } }] } } },
      });
      const result = await checkStatusProgression({ closesIssues: [ref] }, runGraphQL);
      expect(result.findings).toEqual([]);
    }
  });

  it('silently skips an issue not on any tracked board', async () => {
    const runGraphQL = async () => ({ repository: { issue: { projectItems: { nodes: [] } } } });
    const result = await checkStatusProgression({ closesIssues: [ref] }, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fails open per-ref on a GraphQL error without throwing', async () => {
    const runGraphQL = async () => {
      throw new Error('rate limited');
    };
    const result = await checkStatusProgression({ closesIssues: [ref] }, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('resolves each closed-issue ref independently -- one failing ref does not suppress another ref\'s finding', async () => {
    const okRef = { owner: 'acme', repo: 'widgets', number: 1 };
    const badRef = { owner: 'acme', repo: 'widgets', number: 2 };
    const runGraphQL = async (_q: string, vars: Record<string, unknown>) => {
      if (vars.number === 2) throw new Error('network error');
      return { repository: { issue: { projectItems: { nodes: [{ fieldValues: { nodes: [{ name: 'Todo', field: { name: 'Status' } }] } }] } } } };
    };
    const result = await checkStatusProgression({ closesIssues: [okRef, badRef] }, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });
});

function tmpTranscriptWith(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-hygiene-transcript-'));
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n'));
  return path;
}

describe('scanTranscriptForComment', () => {
  it('returns unresolved for a missing transcript path', () => {
    expect(scanTranscriptForComment(undefined, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: false });
  });

  it('returns unresolved for an unreadable transcript file', () => {
    expect(scanTranscriptForComment('/nonexistent/path.jsonl', { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: false });
  });

  it('finds a matching add_issue_comment call anywhere in the transcript', () => {
    const path = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1, body: 'hi' } },
    ]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  it('finds a matching gh issue comment Bash call', () => {
    const path = tmpTranscriptWith([{ tool_name: 'Bash', tool_input: { command: 'gh issue comment 1 --body "hi"' } }]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  it('does not find a comment for a different issue', () => {
    const path = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 99, body: 'hi' } },
    ]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: false });
  });

  it('skips malformed lines without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gdlc-hygiene-transcript-'));
    const path = join(dir, 't.jsonl');
    writeFileSync(path, 'not json\n{"tool_name":"Bash","tool_input":{"command":"gh issue comment 1"}}\n');
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });
});

describe('checkLifecycleComment', () => {
  it('resolves with no findings for a non-transition action', () => {
    const result = checkLifecycleComment({ action: 'gh_command', owner: 'acme', repo: 'widgets', number: 1 }, undefined);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('flags a transition with no comment found this turn', () => {
    const path = tmpTranscriptWith([]);
    const result = checkLifecycleComment({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, path);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });

  it('does not flag a transition when a comment was found', () => {
    const path = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1 } },
    ]);
    const result = checkLifecycleComment({ action: 'set_field_value', owner: 'acme', repo: 'widgets', number: 1 }, path);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('is a silent no-op when the transcript cannot be read', () => {
    const result = checkLifecycleComment({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, '/nonexistent/x.jsonl');
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fires identically for a gh-cli-surfaced update_issue touch (gh issue edit) as for the MCP-tool surface', () => {
    const ghCliTouch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue edit 1 --add-label bug' } }, { owner: 'acme', repo: 'widgets' });
    const path = tmpTranscriptWith([]);
    const result = checkLifecycleComment(ghCliTouch, path);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });
});

describe('checkSubIssueLinkage', () => {
  it('flags an Epic with zero sub-issues', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage({ action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1 }, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('Epic has no sub-issues');
  });

  it('fires identically for a gh-cli-surfaced create_issue touch as for the MCP-tool surface (no surface-specific gap)', async () => {
    const ghCliTouch = extractTouch(
      {
        tool_name: 'Bash',
        tool_input: { command: 'gh issue create --title "Epic X" --body "<!-- mif-type: Epic -->"' },
        tool_output: { stdout: 'https://github.com/acme/widgets/issues/1\n' },
      },
      { owner: 'acme', repo: 'widgets' },
    );
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage(ghCliTouch, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('Epic has no sub-issues');
  });

  it('does not flag an Epic that already has sub-issues', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 3 } } } });
    const result = await checkSubIssueLinkage({ action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1 }, runGraphQL);
    expect(result.findings).toEqual([]);
  });

  it('skips a leaf MIF type (Task/Bug/Feature)', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Task -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage({ action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1 }, runGraphQL);
    expect(result.findings).toEqual([]);
  });

  it('skips a non-create/update action', async () => {
    const result = await checkSubIssueLinkage({ action: 'add_issue_comment', owner: 'acme', repo: 'widgets', number: 1 }, async () => ({}));
    expect(result.findings).toEqual([]);
  });

  it('fails open on a GraphQL error', async () => {
    const runGraphQL = async () => {
      throw new Error('boom');
    };
    const result = await checkSubIssueLinkage({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('skips a close -- closing an empty Epic/Story is a different problem than not-yet-linked', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1, closing: true }, runGraphQL);
    expect(result.findings).toEqual([]);
  });

  it('skips a gh-cli-surfaced close identically to an MCP-surfaced one', async () => {
    const ghCliClose = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue close 1' } }, { owner: 'acme', repo: 'widgets' });
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage(ghCliClose, runGraphQL);
    expect(result.findings).toEqual([]);
  });
});

describe('runHygieneChecks', () => {
  it('combines findings from all three checks', async () => {
    const path = tmpTranscriptWith([]);
    const touch = { action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1, closesIssues: [] };
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Story -->', subIssues: { totalCount: 0 } } } });
    const findings = await runHygieneChecks(touch, { runGraphQL, transcriptPath: path, readFn: undefined });
    expect(findings.some((f) => f.includes('Story has no sub-issues'))).toBe(true);
    expect(findings.some((f) => f.includes('no lifecycle comment'))).toBe(true);
  });

  it('never throws even when a check function itself throws synchronously', async () => {
    const touch = { action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1, closesIssues: [] };
    const throwingRunGraphQL = () => {
      throw new Error('synchronous boom');
    };
    await expect(
      runHygieneChecks(touch, { runGraphQL: throwingRunGraphQL, transcriptPath: undefined, readFn: undefined }),
    ).resolves.toBeInstanceOf(Array);
  });

  it('never rejects even when the FIRST synchronous read of touch.action throws (regression for the eager-evaluation fix)', async () => {
    // Execution order inside runHygieneChecks's array literal is left to
    // right: checkStatusProgression only ever reads touch.closesIssues, so
    // it never trips this trap. With the fix, checkLifecycleComment's own
    // call is deferred into a microtask (`Promise.resolve().then(() =>
    // ...)`), so the FIRST synchronous read of touch.action during array
    // construction is checkSubIssueLinkage's -- an `async function`, whose
    // synchronous throw is auto-wrapped into a rejected settled result, not
    // a raw exception. Before the fix, `Promise.resolve(checkLifecycleComment(...))`
    // called that plain, non-async function directly while the array was
    // still being built, so this exact same first-read throw was a raw
    // synchronous exception that aborted the whole array literal before
    // Promise.allSettled ever ran, rejecting runHygieneChecks entirely.
    let firstAccessSeen = false;
    const throwsOnFirstActionRead = new Proxy(
      { owner: 'acme', repo: 'widgets', number: 1, closesIssues: [] },
      {
        get(target, prop) {
          if (prop === 'action' && !firstAccessSeen) {
            firstAccessSeen = true;
            throw new Error('synchronous property-access boom');
          }
          return Reflect.get(target, prop);
        },
      },
    );
    const runGraphQL = async () => ({});

    await expect(
      runHygieneChecks(throwsOnFirstActionRead, { runGraphQL, transcriptPath: undefined, readFn: undefined }),
    ).resolves.toBeInstanceOf(Array);
    expect(firstAccessSeen).toBe(true);
  });
});

describe('buildAdditionalContext', () => {
  it('returns null for no findings', () => {
    expect(buildAdditionalContext([])).toBeNull();
  });

  it('formats a bulleted reminder for one or more findings', () => {
    const text = buildAdditionalContext(['finding one', 'finding two']);
    expect(text).toContain('Ticket-hygiene reminder:');
    expect(text).toContain('- finding one');
    expect(text).toContain('- finding two');
  });
});
