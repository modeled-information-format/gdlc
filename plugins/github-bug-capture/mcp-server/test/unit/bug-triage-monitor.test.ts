import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
// Dependency-free monitors logic (ADR-0010), tested here for the same
// reason the hooks/lib modules are (outside src/, outside coverage, run
// with bare node by the real monitor process).
import {
  TRIAGE_GRACE_MS,
  buildTriageQuery,
  isBugIssue,
  extractSeverity,
  evaluateBugFindings,
  createBugTriageAssess,
} from '../../../monitors/lib/bug-triage.mjs';
import {
  sessionIssuesFilePath,
  recordCreatedIssue,
  readCreatedIssues,
} from '../../../hooks/lib/session-issues.mjs';

const REF = { owner: 'acme', repo: 'widgets', number: 42 };
const NOW = Date.parse('2026-07-17T12:00:00Z');

function bugIssue(overrides: Record<string, unknown> = {}) {
  return {
    state: 'OPEN',
    createdAt: new Date(NOW - TRIAGE_GRACE_MS - 60_000).toISOString(),
    issueType: { name: 'Bug' },
    labels: { nodes: [] },
    projectItems: { nodes: [] },
    ...overrides,
  };
}

describe('session-issues scratch', () => {
  it('round-trips and dedupes by owner/repo#number', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'gdlc-session-issues-'));
    const file = sessionIssuesFilePath('sess-1', base);
    recordCreatedIssue(file, REF);
    recordCreatedIssue(file, REF);
    recordCreatedIssue(file, { owner: 'acme', repo: 'widgets', number: 43 });
    expect(readCreatedIssues(file)).toEqual([REF, { owner: 'acme', repo: 'widgets', number: 43 }]);
  });

  it('degrades to empty on a missing file and skips malformed lines', () => {
    const base = mkdtempSync(path.join(tmpdir(), 'gdlc-session-issues-'));
    expect(readCreatedIssues(sessionIssuesFilePath('none', base))).toEqual([]);
    const file = sessionIssuesFilePath('bad', base);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `not-json\n${JSON.stringify({ owner: 'a' })}\n${JSON.stringify(REF)}\n`);
    expect(readCreatedIssues(file)).toEqual([REF]);
  });
});

describe('buildTriageQuery', () => {
  it('aliases one block per issue with JSON-escaped literals', () => {
    const q = buildTriageQuery([REF, { owner: 'o2', repo: 'r2', number: 7 }]);
    expect(q).toContain('i0: repository(owner: "acme", name: "widgets")');
    expect(q).toContain('issue(number: 42)');
    expect(q).toContain('i1: repository(owner: "o2", name: "r2")');
    expect(q).toContain('issueType { name }');
  });
});

describe('isBugIssue / extractSeverity', () => {
  it('recognizes the native Bug type and the bug label, case-insensitively', () => {
    expect(isBugIssue(bugIssue())).toBe(true);
    expect(isBugIssue(bugIssue({ issueType: null, labels: { nodes: [{ name: 'Bug' }] } }))).toBe(true);
    expect(isBugIssue(bugIssue({ issueType: { name: 'Feature' }, labels: { nodes: [{ name: 'enhancement' }] } }))).toBe(false);
  });

  it('finds Severity on any project item, null when unset or off-board', () => {
    expect(extractSeverity(bugIssue())).toBeNull();
    const withSeverity = bugIssue({
      projectItems: {
        nodes: [
          { fieldValues: { nodes: [{ name: 'In Progress', field: { name: 'Status' } }] } },
          { fieldValues: { nodes: [{ name: 'High', field: { name: 'Severity' } }] } },
        ],
      },
    });
    expect(extractSeverity(withSeverity)).toBe('High');
  });
});

describe('evaluateBugFindings', () => {
  it('nudges an open, past-grace, severity-less bug', () => {
    const findings = evaluateBugFindings(bugIssue(), REF, NOW);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('bug-triage:acme/widgets#42:no-severity');
    expect(findings[0].message).toContain('set_severity');
  });

  it('respects the grace period', () => {
    const young = bugIssue({ createdAt: new Date(NOW - TRIAGE_GRACE_MS + 60_000).toISOString() });
    expect(evaluateBugFindings(young, REF, NOW)).toEqual([]);
  });

  it('stays silent for triaged, closed, or non-bug issues', () => {
    const triaged = bugIssue({
      projectItems: { nodes: [{ fieldValues: { nodes: [{ name: 'Low', field: { name: 'Severity' } }] } }] },
    });
    expect(evaluateBugFindings(triaged, REF, NOW)).toEqual([]);
    expect(evaluateBugFindings(bugIssue({ state: 'CLOSED' }), REF, NOW)).toEqual([]);
    expect(evaluateBugFindings(bugIssue({ issueType: { name: 'Task' } }), REF, NOW)).toEqual([]);
    expect(evaluateBugFindings(null, REF, NOW)).toEqual([]);
    expect(evaluateBugFindings(bugIssue({ createdAt: 'garbage' }), REF, NOW)).toEqual([]);
  });
});

describe('createBugTriageAssess', () => {
  it('makes zero API calls when nothing was created this session', async () => {
    let calls = 0;
    const assess = createBugTriageAssess({ readCreatedIssuesFn: () => [] });
    expect(
      await assess({
        sessionId: 's',
        runGraphQL: (async () => {
          calls += 1;
          return {};
        }) as never,
        nowMs: NOW,
      } as never),
    ).toEqual([]);
    expect(calls).toBe(0);
  });

  it('fans one aliased query across every created issue, nudging only real gaps', async () => {
    const refs = [REF, { owner: 'acme', repo: 'widgets', number: 43 }];
    const assess = createBugTriageAssess({ readCreatedIssuesFn: () => refs });
    const findings = await assess({
      sessionId: 's',
      runGraphQL: async (q: string) => {
        expect(q).toContain('i0:');
        expect(q).toContain('i1:');
        return {
          i0: { issue: bugIssue() },
          i1: { issue: bugIssue({ issueType: { name: 'Feature' } }) },
        };
      },
      nowMs: NOW,
    } as never);
    expect(findings.map((f: { key: string }) => f.key)).toEqual(['bug-triage:acme/widgets#42:no-severity']);
  });
});

// Spawn-style gating regression for track-created-issues.mjs, mirroring
// github-pull-requests' track-opened-prs tests.
describe('track-created-issues.mjs gating (ADR-0010)', () => {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const hooksDir = path.resolve(thisDir, '../../../hooks');

  function runTracker(configYml: string, sessionId: string, input: Record<string, unknown>): string {
    const root = mkdtempSync(path.join(tmpdir(), 'gdlc-track-issues-'));
    const configDir = path.join(root, '.config', 'gdlc');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, 'config.yml'), configYml);
    const scratchTmp = mkdtempSync(path.join(tmpdir(), 'gdlc-track-issues-tmp-'));
    execFileSync('node', [path.join(hooksDir, 'track-created-issues.mjs')], {
      input: JSON.stringify({ session_id: sessionId, cwd: root, ...input }),
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, TMPDIR: scratchTmp, XDG_CONFIG_HOME: path.join(root, 'no-such-global') },
    });
    return sessionIssuesFilePath(sessionId, scratchTmp);
  }

  const PLANNING_CREATE = {
    tool_name: 'mcp__plugin_github-sdlc-planning_github-sdlc-planning__create_issue',
    tool_input: { owner: 'acme', repo: 'widgets', title: 't', body: 'b' },
    tool_output: JSON.stringify({ number: 99, url: 'https://github.com/acme/widgets/issues/99' }),
  };

  it('records a planning-plugin create_issue when the monitors pack is on', () => {
    const scratch = runTracker('packs:\n  monitors: true\n', 'bt-on', PLANNING_CREATE);
    expect(existsSync(scratch)).toBe(true);
  });

  it('records a gh CLI issue create when the monitors pack is on', () => {
    const scratch = runTracker('packs:\n  monitors: true\n', 'bt-cli', {
      tool_name: 'Bash',
      tool_input: { command: 'gh issue create --repo acme/widgets --title t --body b' },
      tool_output: 'https://github.com/acme/widgets/issues/100\n',
    });
    expect(existsSync(scratch)).toBe(true);
  });

  it('fail-closed: records nothing when the pack is off', () => {
    const scratch = runTracker('packs:\n  hooks: true\n', 'bt-off', PLANNING_CREATE);
    expect(existsSync(scratch)).toBe(false);
  });

  it('ignores non-create touches even with the pack on', () => {
    const scratch = runTracker('packs:\n  monitors: true\n', 'bt-noncreate', {
      tool_name: 'mcp__github__update_issue',
      tool_input: { owner: 'acme', repo: 'widgets', issue_number: 5 },
      tool_output: '{}',
    });
    expect(existsSync(scratch)).toBe(false);
  });
});
