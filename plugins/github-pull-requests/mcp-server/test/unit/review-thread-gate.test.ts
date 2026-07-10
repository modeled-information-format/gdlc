import { describe, expect, it } from 'vitest';
// Dependency-free hooks utility, tested here for the same reason
// pr-lifecycle-config.test.ts is (outside src/, outside coverage, run with
// bare node by the real hooks).
import {
  BRANCH_OR_WORKTREE_CREATE_RE,
  isWorktreeOrBranchCreation,
  checkUnresolvedReviewThreads,
  buildGateReason,
} from '../../../hooks/lib/review-thread-gate.mjs';

describe('isWorktreeOrBranchCreation', () => {
  it('recognizes the EnterWorktree tool by name alone', () => {
    expect(isWorktreeOrBranchCreation('EnterWorktree', {})).toBe(true);
  });

  it('recognizes git worktree add ... -b <branch>', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git worktree add ../../worktrees/foo -b feat/x origin/main' })).toBe(true);
  });

  it('recognizes git checkout -b <branch>', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git checkout -b feat/x' })).toBe(true);
  });

  it('recognizes git switch -c <branch>', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git switch -c feat/x' })).toBe(true);
  });

  it('recognizes a plain git branch <name> (creating)', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch feat/x' })).toBe(true);
  });

  it('does NOT flag git worktree add of an EXISTING branch (no -b, no new branch created)', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git worktree add ../../worktrees/foo origin/main' })).toBe(false);
  });

  it('does NOT flag git branch -d/-D (deleting, not creating)', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -d feat/x' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -D feat/x' })).toBe(false);
  });

  it('does NOT flag a bare git branch --list or no-args listing', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch --list' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch' })).toBe(false);
  });

  it('code-review finding: does NOT flag git branch --show-current -- the exact command this workspace\'s own CLAUDE.local.md mandates running before every phase', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch --show-current' })).toBe(false);
  });

  it('code-review finding: does NOT flag other read-only git branch flags (-a, -r, -vv, -m, --set-upstream-to)', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -a' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -r' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -vv' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch -m old-name new-name' })).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 'git branch --set-upstream-to=origin/main' })).toBe(false);
  });

  it('does not flag an unrelated Bash command', () => {
    expect(isWorktreeOrBranchCreation('Bash', { command: 'npm test' })).toBe(false);
  });

  it('does not flag a non-Bash, non-EnterWorktree tool', () => {
    expect(isWorktreeOrBranchCreation('mcp__github-pull-requests__create_pull_request', {})).toBe(false);
  });

  it('handles a missing/non-string command without throwing', () => {
    expect(isWorktreeOrBranchCreation('Bash', {})).toBe(false);
    expect(isWorktreeOrBranchCreation('Bash', { command: 123 })).toBe(false);
  });
});

describe('BRANCH_OR_WORKTREE_CREATE_RE', () => {
  it('is exported and usable directly', () => {
    expect(BRANCH_OR_WORKTREE_CREATE_RE.test('git checkout -b x')).toBe(true);
  });
});

describe('checkUnresolvedReviewThreads', () => {
  it('returns [] when no PRs are tracked', async () => {
    expect(await checkUnresolvedReviewThreads([], async () => ({}))).toEqual([]);
  });

  it('flags a PR with unresolved threads, with the correct count', async () => {
    const runGraphQL = async () => ({
      repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }, { isResolved: false }] } } },
    });
    const result = await checkUnresolvedReviewThreads([{ owner: 'acme', repo: 'widgets', pullNumber: 9 }], runGraphQL);
    expect(result).toEqual([{ owner: 'acme', repo: 'widgets', pullNumber: 9, unresolved: 2 }]);
  });

  it('does not flag a PR with all threads resolved, or none at all', async () => {
    const allResolved = async () => ({ repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: true }] } } } });
    expect(await checkUnresolvedReviewThreads([{ owner: 'a', repo: 'b', pullNumber: 1 }], allResolved)).toEqual([]);

    const noThreads = async () => ({ repository: { pullRequest: { reviewThreads: { nodes: [] } } } });
    expect(await checkUnresolvedReviewThreads([{ owner: 'a', repo: 'b', pullNumber: 1 }], noThreads)).toEqual([]);
  });

  it('checks every tracked PR independently, flagging only the ones with unresolved threads', async () => {
    const runGraphQL = async (query, vars) => {
      const unresolved = vars.number === 2;
      return { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: !unresolved }] } } } };
    };
    const result = await checkUnresolvedReviewThreads(
      [
        { owner: 'acme', repo: 'widgets', pullNumber: 1 },
        { owner: 'acme', repo: 'widgets', pullNumber: 2 },
      ],
      runGraphQL,
    );
    expect(result).toEqual([{ owner: 'acme', repo: 'widgets', pullNumber: 2, unresolved: 1 }]);
  });

  it('code-review finding: queries every tracked PR concurrently, not one at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runGraphQL = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { repository: { pullRequest: { reviewThreads: { nodes: [] } } } };
    };
    await checkUnresolvedReviewThreads(
      [
        { owner: 'acme', repo: 'widgets', pullNumber: 1 },
        { owner: 'acme', repo: 'widgets', pullNumber: 2 },
        { owner: 'acme', repo: 'widgets', pullNumber: 3 },
      ],
      runGraphQL,
    );
    // A sequential for-of/await loop would never have more than 1 in
    // flight at once; concurrent dispatch via Promise.allSettled lets all
    // 3 overlap.
    expect(maxInFlight).toBe(3);
  });

  it('fails open per-ref: a GraphQL error for one PR never suppresses a finding for another', async () => {
    const runGraphQL = async (query, vars) => {
      if (vars.number === 1) throw new Error('boom');
      return { repository: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false }] } } } };
    };
    const result = await checkUnresolvedReviewThreads(
      [
        { owner: 'acme', repo: 'widgets', pullNumber: 1 },
        { owner: 'acme', repo: 'widgets', pullNumber: 2 },
      ],
      runGraphQL,
    );
    expect(result).toEqual([{ owner: 'acme', repo: 'widgets', pullNumber: 2, unresolved: 1 }]);
  });

  it('handles a malformed/null GraphQL response shape without throwing', async () => {
    expect(await checkUnresolvedReviewThreads([{ owner: 'a', repo: 'b', pullNumber: 1 }], async () => null)).toEqual([]);
    expect(await checkUnresolvedReviewThreads([{ owner: 'a', repo: 'b', pullNumber: 1 }], async () => ({}))).toEqual([]);
  });
});

describe('buildGateReason', () => {
  it('formats a single flagged PR in the singular', () => {
    const reason = buildGateReason([{ owner: 'acme', repo: 'widgets', pullNumber: 9, unresolved: 3 }]);
    expect(reason).toContain('a PR that still has unresolved review');
    expect(reason).toContain('acme/widgets#9 (3 unresolved)');
  });

  it('formats multiple flagged PRs in the plural', () => {
    const reason = buildGateReason([
      { owner: 'acme', repo: 'widgets', pullNumber: 9, unresolved: 1 },
      { owner: 'acme', repo: 'gadgets', pullNumber: 3, unresolved: 2 },
    ]);
    expect(reason).toContain('PRs that still have unresolved review');
    expect(reason).toContain('acme/widgets#9 (1 unresolved)');
    expect(reason).toContain('acme/gadgets#3 (2 unresolved)');
  });
});
