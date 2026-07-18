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
  detectCommaSeparatedClosingKeywords,
  checkClosingKeywordSyntax,
  checkPostMergeClosingKeywords,
  checkSyncNotFoundOnBoard,
  scanTranscriptForComment,
  checkLifecycleComment,
  resolveItemIdentity,
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
    expect(touch).toEqual({ surface: 'gh-cli', action: 'gh_command', owner: 'acme', repo: 'widgets', number: 42, closing: false, closesIssues: [], droppedClosingIssues: [] });
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
    expect(touch.droppedClosingIssues).toEqual([]); // each keyword has its own #N, no comma-list gap
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
    expect(touch).toEqual({ surface: 'gh-cli', action: 'create_issue', owner: 'acme', repo: 'widgets', number: 123, closing: false, closesIssues: [], droppedClosingIssues: [] });
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
    expect(edit).toEqual({ surface: 'gh-cli', action: 'update_issue', owner: 'acme', repo: 'widgets', number: 42, closing: false, closesIssues: [], droppedClosingIssues: [] });

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

  it('honors an explicit -R owner/repo flag over the cwd fallback (Copilot review finding on PR #173)', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh issue edit 5 -R other-owner/other-repo --add-label bug' } },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ owner: 'other-owner', repo: 'other-repo', number: 5 });
  });

  it('honors --repo=owner/repo the same as -R', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh issue view 5 --repo=other-owner/other-repo' } },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ owner: 'other-owner', repo: 'other-repo' });
  });

  it('falls back to the cwd-derived owner/repo when no -R/--repo flag is present', () => {
    const touch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue view 5' } }, { owner: 'acme', repo: 'widgets' });
    expect(touch).toMatchObject({ owner: 'acme', repo: 'widgets' });
  });

  it('never falls back to the (possibly wrong) cwd-derived owner/repo when -R/--repo is present but unparseable', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh issue view 5 -R not-a-valid-repo-spec' } },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ owner: null, repo: null });
  });

  it('honors -R for gh issue create too, so the created issue is attributed to the targeted repo, not the cwd', () => {
    const touch = extractTouch(
      {
        tool_name: 'Bash',
        tool_input: { command: 'gh issue create -R other-owner/other-repo --title "x" --body "y"' },
        tool_output: { stdout: 'https://github.com/other-owner/other-repo/issues/7\n' },
      },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch).toMatchObject({ action: 'create_issue', owner: 'other-owner', repo: 'other-repo', number: 7 });
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

  it('gdlc#201: flags a comma-separated closing-keyword list on the MCP surface (session 1f3d575b PR #368 pattern)', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-pull-requests__create_pull_request', tool_input: { owner: 'acme', repo: 'widgets', body: 'Closes #309, #310, #311, #308' } },
      null,
    );
    expect(touch.droppedClosingIssues).toEqual([310, 311, 308]);
  });

  it('gdlc#201: flags a comma-separated closing-keyword list on the gh-cli surface too', () => {
    const touch = extractTouch(
      { tool_name: 'Bash', tool_input: { command: 'gh pr create --title "x" --body "Closes #309, #310, #311"' } },
      { owner: 'acme', repo: 'widgets' },
    );
    expect(touch.droppedClosingIssues).toEqual([310, 311]);
  });

  it('gdlc#201: does not flag separate keyword-led references, even for multiple issues', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-pull-requests__create_pull_request', tool_input: { owner: 'acme', repo: 'widgets', body: 'Closes #42 and fixes #7' } },
      null,
    );
    expect(touch.droppedClosingIssues).toEqual([]);
  });

  it('gdlc#210: recognizes the generic github MCP server\'s merge_pull_request tool, reading the PR number from pullNumber', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github__merge_pull_request', tool_input: { owner: 'acme', repo: 'widgets', pullNumber: 9 } },
      null,
    );
    expect(touch).toMatchObject({ surface: 'generic-github-mcp', action: 'merge_pull_request', owner: 'acme', repo: 'widgets', number: 9 });
  });

  it('gdlc#210: recognizes gh pr merge on the gh-cli surface, with the positional number', () => {
    const touch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh pr merge 9 --squash' } }, { owner: 'acme', repo: 'widgets' });
    expect(touch).toMatchObject({ surface: 'gh-cli', action: 'merge_pull_request', owner: 'acme', repo: 'widgets', number: 9 });
  });

  it('gdlc#203/#212: recognizes add_sub_issue, using parentNumber (not childNumber) as touch.number', () => {
    const touch = extractTouch(
      {
        tool_name: 'mcp__github-sdlc-planning__add_sub_issue',
        tool_input: { owner: 'acme', repo: 'widgets', parentNumber: 100, childNumber: 105 },
      },
      null,
    );
    expect(touch).toMatchObject({ action: 'add_sub_issue', owner: 'acme', repo: 'widgets', number: 100 });
  });

  it('gdlc#203/#212: recognizes request_review, using pullNumber', () => {
    const touch = extractTouch(
      {
        tool_name: 'mcp__github-pull-requests__request_review',
        tool_input: { owner: 'acme', repo: 'widgets', pullNumber: 42, reviewers: ['Copilot'] },
      },
      null,
    );
    expect(touch).toMatchObject({ action: 'request_review', owner: 'acme', repo: 'widgets', number: 42 });
  });

  it('gdlc#203/#212: recognizes sync_linked_issues_project_field and carries notFoundOnBoard through', () => {
    const touch = extractTouch(
      {
        tool_name: 'mcp__github-pull-requests__sync_linked_issues_project_field',
        tool_input: { owner: 'acme', repo: 'widgets', pullNumber: 371 },
        tool_output: { synced: [], notFoundOnBoard: [319, 320, 321], skippedCrossRepo: [] },
      },
      null,
    );
    expect(touch).toMatchObject({ action: 'sync_linked_issues_project_field', owner: 'acme', repo: 'widgets', number: 371 });
    expect(touch.notFoundOnBoard).toEqual([319, 320, 321]);
  });

  it('gdlc#203/#212: an action with no notFoundOnBoard in its output carries an empty array, not undefined', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__create_issue', tool_input: { owner: 'a', repo: 'b', title: 't', body: 'b', mif: { id: 'x', type: 'Task', namespace: 'ns' } } },
      null,
    );
    expect(touch.notFoundOnBoard).toEqual([]);
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

  it('captures itemId from tool_input for a set_field_value touch, leaving owner/repo/number null', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__set_field_value', tool_input: { itemId: 'PVTI_from_input', fieldId: 'PVTSSF_x', value: { kind: 'text', text: 'v' } } },
      null,
    );
    expect(touch).toMatchObject({ action: 'set_field_value', owner: null, repo: null, number: null, itemId: 'PVTI_from_input' });
  });

  it('falls back to tool_output.itemId when tool_input carries none (Copilot review finding on PR #174) -- SetFieldValueResult echoes itemId back too', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__set_field_value', tool_input: {}, tool_output: { itemId: 'PVTI_from_output' } },
      null,
    );
    expect(touch).toMatchObject({ action: 'set_field_value', itemId: 'PVTI_from_output' });
  });

  it('prefers tool_input.itemId over tool_output.itemId when both are present', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__set_field_value', tool_input: { itemId: 'PVTI_from_input' }, tool_output: { itemId: 'PVTI_from_output' } },
      null,
    );
    expect(touch).toMatchObject({ itemId: 'PVTI_from_input' });
  });

  it('leaves itemId null for a non-set_field_value action, even if tool_input/tool_output happen to carry that key', () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__update_issue', tool_input: { owner: 'acme', repo: 'widgets', number: 1, itemId: 'PVTI_irrelevant' } },
      null,
    );
    expect(touch).toMatchObject({ action: 'update_issue', itemId: null });
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

// Real Claude Code transcript shape (gdlc#289): one line per assistant
// turn, `message.content[]` holding one or more `tool_use` blocks.
function tmpRealTranscriptWith(turns: Array<Array<{ name: string; input: unknown }>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-hygiene-real-transcript-'));
  const path = join(dir, 'transcript.jsonl');
  const lines = turns.map((blocks) =>
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: blocks.map((b) => ({ type: 'tool_use', id: 'toolu_x', name: b.name, input: b.input })) },
    }),
  );
  writeFileSync(path, lines.join('\n'));
  return path;
}

// gdlc#320: a Bash `tool_use` block (given a real, distinct `id` this
// time -- tmpRealTranscriptWith's shared 'toolu_x' can't disambiguate more
// than one call) followed by its own `tool_result` on the NEXT line, the
// real correlation shape a `gh issue comment` command's own stdout arrives
// in. `results` is an array of `{ toolUseId, content }`, `content` being
// either a bare string or the block-array shape, matching the two real
// shapes `toolResultContentText` handles.
function tmpTranscriptWithToolResult(
  calls: Array<{ name: string; input: unknown; id: string }>,
  results: Array<{ toolUseId: string; content: unknown }>,
): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-hygiene-tool-result-'));
  const path = join(dir, 'transcript.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input })) },
    }),
    JSON.stringify({
      type: 'user',
      message: { role: 'user', content: results.map((r) => ({ type: 'tool_result', tool_use_id: r.toolUseId, content: r.content })) },
    }),
  ];
  writeFileSync(path, lines.join('\n'));
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

  it('reads only a bounded tail window, not the whole transcript -- a match past that window is not found', () => {
    // Real behavior test for the default readFn (readTranscriptTail), not
    // an injected stub: proves the 256 KiB bound is actually enforced, not
    // just documented. A match placed well beyond the tail window (padded
    // with ~400 KiB of filler lines first) must NOT be found; the same
    // match placed at the very end of a similarly large file MUST be found.
    const filler = Array.from({ length: 6000 }, () => ({ tool_name: 'Bash', tool_input: { command: 'echo padding-line-to-grow-the-transcript-file' } }));

    const beyondWindow = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1, body: 'hi' } },
      ...filler,
    ]);
    expect(scanTranscriptForComment(beyondWindow, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: false });

    const withinWindow = tmpTranscriptWith([
      ...filler,
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1, body: 'hi' } },
    ]);
    expect(scanTranscriptForComment(withinWindow, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
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

  // gdlc#278 round-2 Copilot finding: this scan is now also reused at Stop
  // time across a whole turn (buildConsolidatedContext's stale-finding
  // re-validation), where a same-numbered issue in a DIFFERENT repo could
  // otherwise wrongly suppress a genuine reminder.
  it('does not match a gh comment command with an explicit --repo flag naming a different repo (same issue number)', () => {
    const path = tmpTranscriptWith([{ tool_name: 'Bash', tool_input: { command: 'gh issue comment 1 --repo other/other-repo --body "hi"' } }]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: false });
  });

  it('does not match a gh comment command with an explicit -R flag naming a different repo (same issue number)', () => {
    const path = tmpTranscriptWith([{ tool_name: 'Bash', tool_input: { command: 'gh issue comment 1 -R other/other-repo --body "hi"' } }]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: false });
  });

  it('still matches a gh comment command with an explicit --repo flag naming the SAME repo', () => {
    const path = tmpTranscriptWith([{ tool_name: 'Bash', tool_input: { command: 'gh issue comment 1 --repo acme/widgets --body "hi"' } }]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  it('still matches a gh comment command with no --repo flag at all (the common case, unchanged)', () => {
    const path = tmpTranscriptWith([{ tool_name: 'Bash', tool_input: { command: 'gh issue comment 1 --body "hi"' } }]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  // gdlc#289: a real Claude Code session transcript line has no bare
  // `tool_name`/`tool_input` at all -- every tool call is a `tool_use`
  // block (keyed `name`/`input`) inside `message.content[]`, and a single
  // assistant turn commonly carries several such blocks on ONE line. The
  // fixtures above (tmpTranscriptWith) predate that discovery and use a
  // flat shape no real transcript actually has; these use the verified
  // real shape instead, proving the fix rather than the fixture's own
  // (wrong) assumption.
  it('finds an MCP add_issue_comment call inside a real transcript entry, sharing a line with a sibling tool_use block', () => {
    const path = tmpRealTranscriptWith([
      [
        { name: 'mcp__github__add_issue_comment', input: { owner: 'acme', repo: 'widgets', issue_number: 1, body: 'hi' } },
        { name: 'mcp__github-sdlc-planning__set_field_value', input: { itemId: 'i1', fieldId: 'f1', value: {} } },
      ],
    ]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  it('finds a literal gh issue comment Bash call inside a real transcript entry, sharing a line with a sibling tool_use block', () => {
    const path = tmpRealTranscriptWith([
      [
        { name: 'Bash', input: { command: 'gh issue comment 1 --body "hi"' } },
        { name: 'mcp__github-sdlc-planning__set_field_value', input: { itemId: 'i1', fieldId: 'f1', value: {} } },
      ],
    ]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: true });
  });

  it('does not find a comment in a real-shape entry when none of its sibling tool_use blocks is a comment', () => {
    const path = tmpRealTranscriptWith([
      [
        { name: 'mcp__github-sdlc-planning__update_issue', input: { owner: 'acme', repo: 'widgets', number: 1 } },
        { name: 'mcp__github-sdlc-planning__set_field_value', input: { itemId: 'i1', fieldId: 'f1', value: {} } },
      ],
    ]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 1 })).toEqual({ resolved: true, found: false });
  });

  // gdlc#320: a shell `for` loop posting a comment to several issues in ONE
  // Bash call (`for n in 545 546; do gh issue comment $n ...; done`) has no
  // literal issue number in its command text at all -- statically
  // unresolvable, per this scan's own pre-#320 doc comment. `gh issue
  // comment`'s own stdout on success is the created comment's URL, printed
  // once per loop iteration, and DOES name the real issue number -- this is
  // the fix: correlate the Bash tool_use's `tool_result` output (by
  // `tool_use_id`) and match the URL against `ref` instead of the command
  // text.
  it('finds a comment for each issue posted via a shell for-loop over a variable issue number (gdlc#320)', () => {
    const command =
      'for n in 545 546; do gh issue comment $n --repo acme/widgets --body "Status: Todo"; done';
    const output = [
      'https://github.com/acme/widgets/issues/545#issuecomment-1000000001',
      'https://github.com/acme/widgets/issues/546#issuecomment-1000000002',
    ].join('\n');
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_loop', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_loop', content: output }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 545 })).toEqual({ resolved: true, found: true });
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 546 })).toEqual({ resolved: true, found: true });
  });

  it('does not find a comment for an issue never mentioned in the for-loop output, even though the command shape matches (gdlc#320)', () => {
    const command = 'for n in 545 546; do gh issue comment $n --repo acme/widgets --body "Status: Todo"; done';
    const output = [
      'https://github.com/acme/widgets/issues/545#issuecomment-1000000001',
      'https://github.com/acme/widgets/issues/546#issuecomment-1000000002',
    ].join('\n');
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_loop', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_loop', content: output }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 547 })).toEqual({ resolved: true, found: false });
  });

  it('finds a comment posted via a single-variable gh issue comment invocation (gdlc#320)', () => {
    const command = 'gh issue comment $ISSUE_NUM --repo acme/widgets --body "Status: In Review"';
    const output = 'https://github.com/acme/widgets/issues/9#issuecomment-2000000001';
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_var', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_var', content: output }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 9 })).toEqual({ resolved: true, found: true });
  });

  it('matches output-based detection against a `gh pr comment` URL too (gdlc#320)', () => {
    const command = 'gh pr comment $n --repo acme/widgets --body "hi"';
    const output = 'https://github.com/acme/widgets/pull/12#issuecomment-3000000001';
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_pr', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_pr', content: output }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 12 })).toEqual({ resolved: true, found: true });
  });

  it('does not cross-match a for-loop output URL against a same-numbered issue in a different repo (gdlc#320)', () => {
    const command = 'for n in 545; do gh issue comment $n --repo other/other-repo --body "hi"; done';
    const output = 'https://github.com/other/other-repo/issues/545#issuecomment-4000000001';
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_other', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_other', content: output }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 545 })).toEqual({ resolved: true, found: false });
  });

  it('handles a tool_result content array (block shape) the same as a bare string (gdlc#320)', () => {
    const command = 'gh issue comment $n --repo acme/widgets --body "hi"';
    const path = tmpTranscriptWithToolResult(
      [{ id: 'toolu_blocks', name: 'Bash', input: { command } }],
      [{ toolUseId: 'toolu_blocks', content: [{ type: 'text', text: 'https://github.com/acme/widgets/issues/22#issuecomment-5000000001' }] }],
    );
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 22 })).toEqual({ resolved: true, found: true });
  });

  it('still returns not-found for a variable-based command when no tool_result output is present at all (fails open, no crash) (gdlc#320)', () => {
    const path = tmpRealTranscriptWith([[{ name: 'Bash', input: { command: 'gh issue comment $n --repo acme/widgets --body "hi"' } }]]);
    expect(scanTranscriptForComment(path, { owner: 'acme', repo: 'widgets', number: 545 })).toEqual({ resolved: true, found: false });
  });
});

describe('checkLifecycleComment', () => {
  it('resolves with no findings for a non-transition action', async () => {
    const result = await checkLifecycleComment({ action: 'gh_command', owner: 'acme', repo: 'widgets', number: 1 }, undefined);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('flags a transition with no comment found this turn', async () => {
    const path = tmpTranscriptWith([]);
    const result = await checkLifecycleComment({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, path);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });

  it('does not flag a transition when a comment was found', async () => {
    const path = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1 } },
    ]);
    const result = await checkLifecycleComment({ action: 'set_field_value', owner: 'acme', repo: 'widgets', number: 1 }, path);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('is a silent no-op when the transcript cannot be read', async () => {
    const result = await checkLifecycleComment({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, '/nonexistent/x.jsonl');
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fires identically for a gh-cli-surfaced update_issue touch (gh issue edit) as for the MCP-tool surface', async () => {
    const ghCliTouch = extractTouch({ tool_name: 'Bash', tool_input: { command: 'gh issue edit 1 --add-label bug' } }, { owner: 'acme', repo: 'widgets' });
    const path = tmpTranscriptWith([]);
    const result = await checkLifecycleComment(ghCliTouch, path);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });

  it('resolves a set_field_value touch\'s itemId to owner/repo/number via GraphQL before scanning (issue #172 fix)', async () => {
    const path = tmpTranscriptWith([]);
    const runGraphQL = async (_query, vars) => {
      expect(vars).toEqual({ itemId: 'PVTI_abc123' });
      return { node: { content: { number: 1, repository: { owner: { login: 'acme' }, name: 'widgets' } } } };
    };
    const touch = { action: 'set_field_value', owner: null, repo: null, number: null, itemId: 'PVTI_abc123' };
    const result = await checkLifecycleComment(touch, path, undefined, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#1');
  });

  it('does not flag a set_field_value touch when a comment for the resolved issue was found', async () => {
    const path = tmpTranscriptWith([
      { tool_name: 'mcp__github__add_issue_comment', tool_input: { owner: 'acme', repo: 'widgets', issue_number: 1 } },
    ]);
    const runGraphQL = async () => ({ node: { content: { number: 1, repository: { owner: { login: 'acme' }, name: 'widgets' } } } });
    const touch = { action: 'set_field_value', owner: null, repo: null, number: null, itemId: 'PVTI_abc123' };
    const result = await checkLifecycleComment(touch, path, undefined, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fails open (no finding, never a guess) when itemId resolution cannot determine owner/repo/number', async () => {
    const path = tmpTranscriptWith([]);
    const runGraphQL = async () => ({ node: { content: null } }); // e.g. a Draft Issue item
    const touch = { action: 'set_field_value', owner: null, repo: null, number: null, itemId: 'PVTI_abc123' };
    const result = await checkLifecycleComment(touch, path, undefined, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fails open when the itemId-resolution GraphQL call itself throws', async () => {
    const path = tmpTranscriptWith([]);
    const runGraphQL = async () => {
      throw new Error('rate limited');
    };
    const touch = { action: 'set_field_value', owner: null, repo: null, number: null, itemId: 'PVTI_abc123' };
    const result = await checkLifecycleComment(touch, path, undefined, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('does not attempt identity resolution for a set_field_value touch with no itemId at all', async () => {
    const path = tmpTranscriptWith([]);
    const runGraphQL = async () => {
      throw new Error('should never be called');
    };
    const touch = { action: 'set_field_value', owner: null, repo: null, number: null, itemId: null };
    const result = await checkLifecycleComment(touch, path, undefined, runGraphQL);
    expect(result).toEqual({ resolved: true, findings: [] });
  });
});

describe('resolveItemIdentity', () => {
  it('resolves an Issue-backed project item to owner/repo/number', async () => {
    const runGraphQL = async (_query, vars) => {
      expect(vars).toEqual({ itemId: 'PVTI_x' });
      return { node: { content: { number: 42, repository: { owner: { login: 'acme' }, name: 'widgets' } } } };
    };
    expect(await resolveItemIdentity('PVTI_x', runGraphQL)).toEqual({ owner: 'acme', repo: 'widgets', number: 42 });
  });

  it('resolves a PullRequest-backed project item too', async () => {
    const runGraphQL = async () => ({ node: { content: { number: 7, repository: { owner: { login: 'acme' }, name: 'widgets' } } } });
    expect(await resolveItemIdentity('PVTI_x', runGraphQL)).toEqual({ owner: 'acme', repo: 'widgets', number: 7 });
  });

  it('returns null for a Draft Issue item (no linked content)', async () => {
    const runGraphQL = async () => ({ node: { content: null } });
    expect(await resolveItemIdentity('PVTI_x', runGraphQL)).toBeNull();
  });

  it('returns null on a malformed response', async () => {
    const runGraphQL = async () => ({});
    expect(await resolveItemIdentity('PVTI_x', runGraphQL)).toBeNull();
  });

  it('returns null (never throws) on a GraphQL error', async () => {
    const runGraphQL = async () => {
      throw new Error('boom');
    };
    expect(await resolveItemIdentity('PVTI_x', runGraphQL)).toBeNull();
  });
});

describe('checkSubIssueLinkage', () => {
  it('flags an Epic with zero sub-issues', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage({ action: 'create_issue', owner: 'acme', repo: 'widgets', number: 1 }, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('Epic has no sub-issues');
  });

  it('gdlc#203/#212: fires on add_sub_issue, re-checking the PARENT (touch.number), catching a call that succeeded against the wrong parent', async () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__add_sub_issue', tool_input: { owner: 'acme', repo: 'widgets', parentNumber: 100, childNumber: 105 } },
      null,
    );
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 0 } } } });
    const result = await checkSubIssueLinkage(touch, runGraphQL);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('acme/widgets#100');
  });

  it('gdlc#203/#212: does not flag add_sub_issue when the parent now genuinely has sub-issues', async () => {
    const touch = extractTouch(
      { tool_name: 'mcp__github-sdlc-planning__add_sub_issue', tool_input: { owner: 'acme', repo: 'widgets', parentNumber: 100, childNumber: 105 } },
      null,
    );
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: { totalCount: 1 } } } });
    const result = await checkSubIssueLinkage(touch, runGraphQL);
    expect(result.findings).toEqual([]);
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

  it('fails open on an ambiguous response -- a non-numeric totalCount is never treated as zero', async () => {
    const runGraphQL = async () => ({ repository: { issue: { body: '<!-- mif-type: Epic -->', subIssues: {} } } });
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

describe('detectCommaSeparatedClosingKeywords', () => {
  it('returns [] for non-string input', () => {
    expect(detectCommaSeparatedClosingKeywords(undefined)).toEqual([]);
    expect(detectCommaSeparatedClosingKeywords(null)).toEqual([]);
  });

  it('returns [] for a body with no closing keyword at all', () => {
    expect(detectCommaSeparatedClosingKeywords('Just a description, with a comma.')).toEqual([]);
  });

  it('returns [] for a single #N reference, the unambiguous correct form', () => {
    expect(detectCommaSeparatedClosingKeywords('Closes #42')).toEqual([]);
  });

  it('returns every dropped number for a 4-issue comma list (the exact PR #368 pattern)', () => {
    expect(detectCommaSeparatedClosingKeywords('Closes #309, #310, #311, #308')).toEqual([310, 311, 308]);
  });

  it('is case-insensitive and matches fix/fixes/fixed/resolve/resolves/resolved too', () => {
    expect(detectCommaSeparatedClosingKeywords('FIXES #1, #2')).toEqual([2]);
    expect(detectCommaSeparatedClosingKeywords('resolved #1, #2, #3')).toEqual([2, 3]);
  });

  it('does not flag two SEPARATE keyword-led clauses, only a true comma-list under one keyword', () => {
    expect(detectCommaSeparatedClosingKeywords('Closes #1. Also fixes #2.')).toEqual([]);
  });

  it('dedupes a number that appears dropped in more than one clause (Closes #1,#2 and fixes #3,#2 both drop #2)', () => {
    // #3 is the FIRST reference in its own clause -- GitHub honors it, it is
    // never dropped. Only #2 (second in both clauses) is dropped, and only
    // once despite appearing in two separate matches.
    expect(detectCommaSeparatedClosingKeywords('Closes #1, #2. Later: fixes #3, #2.')).toEqual([2]);
  });
});

describe('checkClosingKeywordSyntax', () => {
  it('returns no findings for a touch with no droppedClosingIssues', () => {
    expect(checkClosingKeywordSyntax({ droppedClosingIssues: [] })).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings for a touch missing the field entirely (older/unrelated touch shape)', () => {
    expect(checkClosingKeywordSyntax({ action: 'update_issue' })).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings for a null touch', () => {
    expect(checkClosingKeywordSyntax(null)).toEqual({ resolved: true, findings: [] });
  });

  it('surfaces every dropped number in one finding', () => {
    const result = checkClosingKeywordSyntax({ droppedClosingIssues: [310, 311, 308] });
    expect(result.resolved).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('#310, #311, #308');
    expect(result.findings[0]).toContain('only auto-closes the FIRST issue');
  });
});

describe('checkPostMergeClosingKeywords', () => {
  const mergeTouch = { action: 'merge_pull_request', owner: 'acme', repo: 'widgets', number: 368 };

  it('returns no findings for a non-merge touch', async () => {
    const result = await checkPostMergeClosingKeywords({ action: 'update_issue', owner: 'acme', repo: 'widgets', number: 1 }, async () => ({}));
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings for a null touch', async () => {
    expect(await checkPostMergeClosingKeywords(null, async () => ({}))).toEqual({ resolved: true, findings: [] });
  });

  it('fails open (no finding) when the PR query throws', async () => {
    const result = await checkPostMergeClosingKeywords(mergeTouch, async () => {
      throw new Error('boom');
    });
    expect(result).toEqual({ resolved: true, findings: [] });
  });

  it('fails open when the PR is not actually merged yet (e.g. a failed merge attempt)', async () => {
    const runGraphQL = async () => ({ repository: { pullRequest: { merged: false, body: 'Closes #309, #310' } } });
    expect(await checkPostMergeClosingKeywords(mergeTouch, runGraphQL)).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings when the merged PR body has no closing keywords at all', async () => {
    const runGraphQL = async () => ({ repository: { pullRequest: { merged: true, body: 'just a description' } } });
    expect(await checkPostMergeClosingKeywords(mergeTouch, runGraphQL)).toEqual({ resolved: true, findings: [] });
  });

  it('reproduces the PR #368 pattern: flags every comma-dropped issue still open post-merge', async () => {
    const runGraphQL = async (query, vars) => {
      if (query.includes('pullRequest')) {
        return { repository: { pullRequest: { merged: true, body: 'Closes #309, #310, #311, #308' } } };
      }
      // #309 was the one GitHub actually auto-closed; #310/#311/#308 were
      // silently left open -- exactly what happened in session 1f3d575b
      // before the agent caught and manually fixed it.
      const closed = new Set([309]);
      return { repository: { issue: { state: closed.has(vars.number) ? 'CLOSED' : 'OPEN' } } };
    };
    const result = await checkPostMergeClosingKeywords(mergeTouch, runGraphQL);
    expect(result.resolved).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('#310');
    expect(result.findings[0]).toContain('#311');
    expect(result.findings[0]).toContain('#308');
    expect(result.findings[0]).not.toContain('#309');
  });

  it('returns no findings when every referenced issue is actually closed', async () => {
    const runGraphQL = async (query) => {
      if (query.includes('pullRequest')) return { repository: { pullRequest: { merged: true, body: 'Closes #1, #2' } } };
      return { repository: { issue: { state: 'CLOSED' } } };
    };
    expect(await checkPostMergeClosingKeywords(mergeTouch, runGraphQL)).toEqual({ resolved: true, findings: [] });
  });

  it('fails open per-issue-ref when one issue-state query throws, without losing findings for the others', async () => {
    const runGraphQL = async (query, vars) => {
      if (query.includes('pullRequest')) return { repository: { pullRequest: { merged: true, body: 'Closes #1, #2' } } };
      if (vars.number === 1) throw new Error('boom');
      return { repository: { issue: { state: 'OPEN' } } };
    };
    const result = await checkPostMergeClosingKeywords(mergeTouch, runGraphQL);
    expect(result.findings[0]).toContain('#2');
    expect(result.findings[0]).not.toContain('#1');
  });
});

describe('checkSyncNotFoundOnBoard', () => {
  it('returns no findings when notFoundOnBoard is empty', () => {
    expect(checkSyncNotFoundOnBoard({ notFoundOnBoard: [] })).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings for a touch missing the field entirely', () => {
    expect(checkSyncNotFoundOnBoard({ action: 'update_issue' })).toEqual({ resolved: true, findings: [] });
  });

  it('returns no findings for a null touch', () => {
    expect(checkSyncNotFoundOnBoard(null)).toEqual({ resolved: true, findings: [] });
  });

  it('surfaces every notFoundOnBoard number, reproducing the gdlc#200 symptom (issues #319-323)', () => {
    const touch = { notFoundOnBoard: [319, 320, 321, 322, 323], owner: 'modeled-information-format', repo: 'research-harness-template', number: 371 };
    const result = checkSyncNotFoundOnBoard(touch);
    expect(result.resolved).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toContain('#319, #320, #321, #322, #323');
    expect(result.findings[0]).toContain('modeled-information-format/research-harness-template#371');
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

  it('gdlc#201: surfaces checkClosingKeywordSyntax findings alongside the other three', async () => {
    const touch = {
      action: 'create_pull_request',
      owner: 'acme',
      repo: 'widgets',
      number: 5,
      closesIssues: [],
      droppedClosingIssues: [310, 311],
    };
    const runGraphQL = async () => ({});
    const findings = await runHygieneChecks(touch, { runGraphQL, transcriptPath: undefined, readFn: undefined });
    expect(findings.some((f) => f.includes('#310, #311'))).toBe(true);
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
    // checkStatusProgression, checkLifecycleComment, and checkSubIssueLinkage
    // are all `async function`s now (checkLifecycleComment became one as
    // part of issue #172's fix), and every one of them is called directly
    // (no `.then()` deferral wrapper) while runHygieneChecks's array literal
    // is built. Whichever of them reads `touch.action` first, a synchronous
    // throw during that read is caught by the implicit async-function
    // promise-wrapping and converted into a rejected settled result, never a
    // raw exception -- so array construction always completes and
    // Promise.allSettled always runs. Before the original eager-evaluation
    // fix, `Promise.resolve(checkLifecycleComment(...))` called a plain,
    // non-async function directly, so its synchronous throw WAS a raw
    // exception that aborted the whole array literal before
    // Promise.allSettled ever ran, rejecting runHygieneChecks entirely; this
    // test still guards against that class of regression regardless of
    // which check happens to touch `.action` first.
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
