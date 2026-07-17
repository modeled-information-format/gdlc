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
  buildSettlementQuery,
  evaluatePrFindings,
  createPrSettlementAssess,
} from '../../../monitors/lib/pr-settlement.mjs';
import { sessionPrsFilePath } from '../../../hooks/lib/session-prs.mjs';

const REF = { owner: 'acme', repo: 'widgets', pullNumber: 77 };

function prNode(overrides: Record<string, unknown> = {}) {
  return {
    state: 'OPEN',
    merged: false,
    isDraft: false,
    headRefOid: 'abcdef1234567890',
    reviewDecision: null,
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
    reviewThreads: { nodes: [] },
    ...overrides,
  };
}

describe('buildSettlementQuery', () => {
  it('aliases one block per PR with JSON-escaped literals', () => {
    const q = buildSettlementQuery([REF, { owner: 'o"2', repo: 'r2', pullNumber: 8 }]);
    expect(q).toContain('p0: repository(owner: "acme", name: "widgets")');
    expect(q).toContain('pullRequest(number: 77)');
    expect(q).toContain('p1: repository(owner: "o\\"2", name: "r2")');
    expect(q).toContain('reviewThreads(first: 100)');
  });
});

describe('evaluatePrFindings', () => {
  it('merged: one-time verify nudge, nothing else', () => {
    const findings = evaluatePrFindings(prNode({ merged: true, state: 'MERGED' }), REF);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('pr-settlement:acme/widgets#77:merged');
    expect(findings[0].message).toContain('board Status reads Done');
  });

  it('closed-unmerged: silent', () => {
    expect(evaluatePrFindings(prNode({ state: 'CLOSED' }), REF)).toEqual([]);
  });

  it('failing checks: keyed by the current head so a push re-arms', () => {
    const findings = evaluatePrFindings(
      prNode({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }),
      REF,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('pr-settlement:acme/widgets#77:ci-failed:abcdef123456');
  });

  it('draft: CI signal only, no review/merge shepherding', () => {
    const red = evaluatePrFindings(
      prNode({ isDraft: true, commits: { nodes: [{ commit: { statusCheckRollup: { state: 'ERROR' } } }] } }),
      REF,
    );
    expect(red.map((f: { key: string }) => f.key)).toEqual(['pr-settlement:acme/widgets#77:ci-failed:abcdef123456']);
    const green = evaluatePrFindings(prNode({ isDraft: true, reviewDecision: 'APPROVED' }), REF);
    expect(green).toEqual([]);
  });

  it('CHANGES_REQUESTED and unresolved threads each nudge, count in the thread key', () => {
    const findings = evaluatePrFindings(
      prNode({
        reviewDecision: 'CHANGES_REQUESTED',
        reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }, { isResolved: true }] },
      }),
      REF,
    );
    expect(findings.map((f: { key: string }) => f.key)).toEqual([
      'pr-settlement:acme/widgets#77:changes-requested:abcdef123456',
      'pr-settlement:acme/widgets#77:threads:2:abcdef123456',
    ]);
    expect(findings[1].message).toContain('2 unresolved review threads');
  });

  it('settled: green + approved + zero unresolved -> merge nudge', () => {
    const findings = evaluatePrFindings(prNode({ reviewDecision: 'APPROVED' }), REF);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('pr-settlement:acme/widgets#77:settled:abcdef123456');
    expect(findings[0].message).toContain('merge it');
  });

  it('not settled while threads remain, even approved and green', () => {
    const findings = evaluatePrFindings(
      prNode({ reviewDecision: 'APPROVED', reviewThreads: { nodes: [{ isResolved: false }] } }),
      REF,
    );
    expect(findings.map((f: { key: string }) => f.key)).toEqual(['pr-settlement:acme/widgets#77:threads:1:abcdef123456']);
  });

  it('pending checks (no rollup / PENDING): no CI nudge and no settled nudge', () => {
    expect(evaluatePrFindings(prNode({ commits: { nodes: [] }, reviewDecision: 'APPROVED' }), REF)).toEqual([]);
    expect(
      evaluatePrFindings(
        prNode({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'PENDING' } } }] }, reviewDecision: 'APPROVED' }),
        REF,
      ),
    ).toEqual([]);
  });

  it('a vanished PR node is silent', () => {
    expect(evaluatePrFindings(null, REF)).toEqual([]);
  });
});

describe('createPrSettlementAssess', () => {
  it('makes zero API calls when no PRs were opened this session', async () => {
    let calls = 0;
    const assess = createPrSettlementAssess({ readOpenedPrsFn: () => [] });
    const findings = await assess({
      sessionId: 's',
      runGraphQL: (async () => {
        calls += 1;
        return {};
      }) as never,
    } as never);
    expect(findings).toEqual([]);
    expect(calls).toBe(0);
  });

  it('fans one aliased query across every session PR and merges findings', async () => {
    const refs = [REF, { owner: 'acme', repo: 'gizmos', pullNumber: 9 }];
    const assess = createPrSettlementAssess({ readOpenedPrsFn: () => refs });
    const findings = await assess({
      sessionId: 's',
      runGraphQL: async (q: string) => {
        expect(q).toContain('p0:');
        expect(q).toContain('p1:');
        return {
          p0: { pullRequest: prNode({ reviewDecision: 'APPROVED' }) },
          p1: { pullRequest: prNode({ merged: true, state: 'MERGED' }) },
        };
      },
    } as never);
    expect(findings.map((f: { key: string }) => f.key)).toEqual([
      'pr-settlement:acme/widgets#77:settled:abcdef123456',
      'pr-settlement:acme/gizmos#9:merged',
    ]);
  });

  // Code-review finding on the introducing PR: the merged key never
  // changes and the session scratch never forgets a PR, so without
  // retirement the cooldown alone would re-nudge "is merged" every 30
  // minutes forever. Terminal PRs must leave the polling set after their
  // one report.
  it('retires merged and closed PRs from later cycles (one terminal report, then zero API cost)', async () => {
    const refs = [REF, { owner: 'acme', repo: 'gizmos', pullNumber: 9 }];
    const assess = createPrSettlementAssess({ readOpenedPrsFn: () => refs });
    let calls = 0;
    const run = () =>
      assess({
        sessionId: 's',
        runGraphQL: async (q: string) => {
          calls += 1;
          // After cycle 1 retires both (one merged, one closed-unmerged),
          // no query should ever mention them again.
          if (calls > 1) throw new Error(`unexpected query: ${q}`);
          return {
            p0: { pullRequest: prNode({ merged: true, state: 'MERGED' }) },
            p1: { pullRequest: prNode({ state: 'CLOSED' }) },
          };
        },
      } as never);
    const first = await run();
    expect(first.map((f: { key: string }) => f.key)).toEqual(['pr-settlement:acme/widgets#77:merged']);
    const second = await run();
    expect(second).toEqual([]);
    expect(calls).toBe(1);
  });

  it('does not retire a PR whose node vanished from the response (transient API hiccup)', async () => {
    const assess = createPrSettlementAssess({ readOpenedPrsFn: () => [REF] });
    let calls = 0;
    const run = (node: unknown) =>
      assess({
        sessionId: 's',
        runGraphQL: async () => {
          calls += 1;
          return { p0: { pullRequest: node } };
        },
      } as never);
    expect(await run(null)).toEqual([]);
    // Still polled next cycle -- and reportable once the node comes back.
    const second = await run(prNode({ merged: true, state: 'MERGED' }));
    expect(second.map((f: { key: string }) => f.key)).toEqual(['pr-settlement:acme/widgets#77:merged']);
    expect(calls).toBe(2);
  });
});

// Regression for the ADR-0010 gating widening: the monitors pack alone
// (no prLifecycle opt-in) must keep track-opened-prs.mjs recording, and
// the fail-closed default (neither surface enabled) must not. Spawn-style,
// mirroring hooks.test.ts.
describe('track-opened-prs.mjs gating (ADR-0010)', () => {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  const hooksDir = path.resolve(thisDir, '../../../hooks');

  function runTracker(configYml: string, sessionId: string): string {
    const root = mkdtempSync(path.join(tmpdir(), 'gdlc-track-prs-'));
    const configDir = path.join(root, '.config', 'gdlc');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(path.join(configDir, 'config.yml'), configYml);
    const scratchTmp = mkdtempSync(path.join(tmpdir(), 'gdlc-track-prs-tmp-'));
    execFileSync('node', [path.join(hooksDir, 'track-opened-prs.mjs')], {
      input: JSON.stringify({
        session_id: sessionId,
        cwd: root,
        tool_name: 'Bash',
        tool_input: { command: 'gh pr create --repo acme/widgets --title t --body b' },
        tool_output: 'https://github.com/acme/widgets/pull/55\n',
      }),
      encoding: 'utf8',
      cwd: root,
      env: { ...process.env, TMPDIR: scratchTmp, XDG_CONFIG_HOME: path.join(root, 'no-such-global') },
    });
    return sessionPrsFilePath(sessionId, scratchTmp);
  }

  it('records a PR with only packs.monitors enabled', () => {
    const scratch = runTracker('packs:\n  monitors: true\n', 'monitors-only-session');
    expect(existsSync(scratch)).toBe(true);
  });

  it('still records under the original prLifecycle gate', () => {
    const scratch = runTracker('prLifecycle:\n  enabled: true\n', 'lifecycle-session');
    expect(existsSync(scratch)).toBe(true);
  });

  it('fail-closed: records nothing when neither surface is enabled', () => {
    const scratch = runTracker('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n', 'disabled-session');
    expect(existsSync(scratch)).toBe(false);
  });
});
