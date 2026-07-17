import { describe, expect, it } from 'vitest';
// Dependency-free monitors logic (ADR-0010), tested here for the same
// reason monitor-core.test.ts is (outside src/, outside coverage, run
// with bare node by the real monitor process).
import {
  GIT_STALENESS_MS,
  extractBoardItem,
  evaluateBoardFindings,
  evaluateGitStaleness,
  createBoardHygieneAssess,
} from '../../../monitors/lib/board-hygiene.mjs';

const CONFIG = { projectOwnerLogin: 'acme', projectNumber: 1, projectOwnerType: 'organization' };
const REF = { owner: 'acme', repo: 'widgets', number: 123 };

function issueData({
  state = 'OPEN',
  status = null as string | null,
  onBoard = true,
  itemUpdatedAt = '2026-07-17T00:00:00Z',
  lastCommentAt = null as string | null,
  closingPrStates = [] as string[],
} = {}) {
  return {
    repository: {
      issue: {
        state,
        projectItems: {
          nodes: onBoard
            ? [
                {
                  updatedAt: itemUpdatedAt,
                  project: { number: 1, owner: { login: 'acme' } },
                  fieldValues: { nodes: status === null ? [] : [{ name: status, field: { name: 'Status' } }] },
                },
                // An item on a DIFFERENT board must never be matched.
                {
                  updatedAt: itemUpdatedAt,
                  project: { number: 9, owner: { login: 'someone-else' } },
                  fieldValues: { nodes: [{ name: 'Done', field: { name: 'Status' } }] },
                },
              ]
            : [],
        },
        closedByPullRequestsReferences: { nodes: closingPrStates.map((s) => ({ state: s })) },
        comments: { nodes: lastCommentAt === null ? [] : [{ createdAt: lastCommentAt }] },
      },
    },
  };
}

describe('extractBoardItem', () => {
  it('matches by project number + owner login, not by position', () => {
    expect(extractBoardItem(issueData({ status: 'Todo' }), CONFIG)).toEqual({
      status: 'Todo',
      itemUpdatedAt: '2026-07-17T00:00:00Z',
    });
  });

  it('returns null when the issue is not on the configured board', () => {
    expect(extractBoardItem(issueData({ onBoard: false }), CONFIG)).toBeNull();
  });
});

describe('evaluateBoardFindings', () => {
  it('nudges In Progress when work is happening but Status is Todo or unset', () => {
    for (const status of ['Todo', null]) {
      const findings = evaluateBoardFindings(issueData({ status }), REF, CONFIG);
      expect(findings).toHaveLength(1);
      expect(findings[0].key).toBe(`board-hygiene:acme/widgets#123:todo:${status ?? 'unset'}`);
      expect(findings[0].message).toContain('set Status to In Progress');
    }
  });

  it('nudges Done when the issue closed but the board did not follow', () => {
    const findings = evaluateBoardFindings(issueData({ state: 'CLOSED', status: 'In Progress' }), REF, CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('board-hygiene:acme/widgets#123:closed-not-done:In Progress');
    expect(findings[0].message).toContain('set Status to Done');
  });

  it('stays silent for a closed issue already marked Done', () => {
    expect(evaluateBoardFindings(issueData({ state: 'CLOSED', status: 'Done' }), REF, CONFIG)).toEqual([]);
  });

  it('nudges when Status says Done but the issue is still open', () => {
    const findings = evaluateBoardFindings(issueData({ status: 'Done' }), REF, CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('board-hygiene:acme/widgets#123:done-but-open');
  });

  it('nudges a Blocked item with no comment since the status change, keyed by the change time', () => {
    const noComment = evaluateBoardFindings(issueData({ status: 'Blocked' }), REF, CONFIG);
    expect(noComment).toHaveLength(1);
    expect(noComment[0].key).toBe('board-hygiene:acme/widgets#123:blocked-no-comment:2026-07-17T00:00:00Z');

    const staleComment = evaluateBoardFindings(
      issueData({ status: 'Blocked', lastCommentAt: '2026-07-16T00:00:00Z' }),
      REF,
      CONFIG,
    );
    expect(staleComment).toHaveLength(1);

    const explained = evaluateBoardFindings(
      issueData({ status: 'Blocked', lastCommentAt: '2026-07-17T01:00:00Z' }),
      REF,
      CONFIG,
    );
    expect(explained).toEqual([]);
  });

  it('nudges In Review with no live PR, and accepts an open or merged one', () => {
    const noPr = evaluateBoardFindings(issueData({ status: 'In Review' }), REF, CONFIG);
    expect(noPr).toHaveLength(1);
    expect(noPr[0].key).toBe('board-hygiene:acme/widgets#123:in-review-no-pr');

    expect(evaluateBoardFindings(issueData({ status: 'In Review', closingPrStates: ['OPEN'] }), REF, CONFIG)).toEqual([]);
    expect(evaluateBoardFindings(issueData({ status: 'In Review', closingPrStates: ['MERGED'] }), REF, CONFIG)).toEqual([]);
    // A closed-unmerged PR is not a live review vehicle.
    expect(evaluateBoardFindings(issueData({ status: 'In Review', closingPrStates: ['CLOSED'] }), REF, CONFIG)).toHaveLength(1);
  });

  it('is silent for the healthy path and for malformed data', () => {
    expect(evaluateBoardFindings(issueData({ status: 'In Progress' }), REF, CONFIG)).toEqual([]);
    expect(evaluateBoardFindings({}, REF, CONFIG)).toEqual([]);
    expect(evaluateBoardFindings(null, REF, CONFIG)).toEqual([]);
  });

  it('does not fire the todo nudge for an issue not on the board at all', () => {
    // ADR-0007's checkSyncNotFoundOnBoard owns "not on board"; this monitor
    // must not duplicate it.
    expect(evaluateBoardFindings(issueData({ onBoard: false }), REF, CONFIG)).toEqual([]);
  });
});

describe('evaluateGitStaleness', () => {
  it('arms on first dirt, resets on change, fires once past the threshold', () => {
    const tracker = { signature: null, dirtySinceMs: null };
    expect(evaluateGitStaleness(' M a.ts', tracker, 0, REF)).toBeNull(); // arms
    expect(evaluateGitStaleness(' M a.ts\n M b.ts', tracker, 10_000, REF)).toBeNull(); // changed -> re-arms
    expect(evaluateGitStaleness(' M a.ts\n M b.ts', tracker, 10_000 + GIT_STALENESS_MS - 1, REF)).toBeNull();
    const finding = evaluateGitStaleness(' M a.ts\n M b.ts', tracker, 10_000 + GIT_STALENESS_MS, REF);
    expect(finding?.key).toBe('board-hygiene:git-dirty:10000');
    expect(finding?.message).toContain('acme/widgets#123');
    expect(finding?.message).toContain('commit or stash');
  });

  it('clears the tracker on a clean tree', () => {
    const tracker = { signature: ' M a.ts', dirtySinceMs: 0 };
    expect(evaluateGitStaleness('', tracker, GIT_STALENESS_MS * 2, REF)).toBeNull();
    expect(tracker.signature).toBeNull();
  });
});

describe('createBoardHygieneAssess', () => {
  it('returns no findings when no active issue is recorded for the session', async () => {
    const assess = createBoardHygieneAssess({
      readActiveIssueFn: () => null,
      readBoardConfigFn: () => CONFIG,
      runGitFn: () => ' M a.ts',
    });
    expect(await assess({ sessionId: 's', cwd: '/ws', runGraphQL: async () => issueData(), nowMs: 0 })).toEqual([]);
  });

  it('runs board checks against the query response when configured', async () => {
    const queries: unknown[] = [];
    const assess = createBoardHygieneAssess({
      readActiveIssueFn: () => REF,
      readBoardConfigFn: () => CONFIG,
      runGitFn: () => '',
    });
    const findings = await assess({
      sessionId: 's',
      cwd: '/ws',
      runGraphQL: async (_q: string, vars: unknown) => {
        queries.push(vars);
        return issueData({ state: 'CLOSED', status: 'In Progress' });
      },
      nowMs: 0,
    });
    expect(queries).toEqual([{ owner: 'acme', repo: 'widgets', number: 123 }]);
    expect(findings.map((f: { key: string }) => f.key)).toEqual(['board-hygiene:acme/widgets#123:closed-not-done:In Progress']);
  });

  it('skips the GraphQL round trip entirely when no board is configured, but still watches git', async () => {
    let graphqlCalls = 0;
    const assess = createBoardHygieneAssess({
      readActiveIssueFn: () => REF,
      readBoardConfigFn: () => null,
      runGitFn: () => ' M a.ts',
    });
    const run = async (nowMs: number) =>
      assess({
        sessionId: 's',
        cwd: '/ws',
        runGraphQL: (async () => {
          graphqlCalls += 1;
          return {};
        }) as never,
        nowMs,
      });
    expect(await run(0)).toEqual([]); // arms the tracker
    const findings = await run(GIT_STALENESS_MS);
    expect(graphqlCalls).toBe(0);
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('board-hygiene:git-dirty:0');
  });

  it('a git failure never blocks the board checks', async () => {
    const assess = createBoardHygieneAssess({
      readActiveIssueFn: () => REF,
      readBoardConfigFn: () => CONFIG,
      runGitFn: () => {
        throw new Error('not a git repository');
      },
    });
    const findings = await assess({
      sessionId: 's',
      cwd: '/ws',
      runGraphQL: async () => issueData({ status: 'Todo' }),
      nowMs: 0,
    });
    expect(findings.map((f: { key: string }) => f.key)).toEqual(['board-hygiene:acme/widgets#123:todo:Todo']);
  });
});
