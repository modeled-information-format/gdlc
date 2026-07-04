import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { classifyPullRequest } from '../../src/tools/classify-pull-request.js';

// classifyPullRequest can issue several sequential mutating calls (label
// deletes/creates/applies); skip the real mutation-pacing wait in tests.
const fastDeps = { sleep: () => Promise.resolve() };

function mockPull(additions: number, deletions: number, changedFiles: number, labels: string[] = []): void {
  mockRest('get', '/repos/acme/widgets/pulls/1', {
    additions,
    deletions,
    changed_files: changedFiles,
    labels: labels.map((name) => ({ name })),
  });
}

describe('classifyPullRequest', () => {
  it.each([
    [0, 9, 'XS'],
    [10, 19, 'S'],
    [30, 69, 'M'],
    [100, 399, 'L'],
    [500, 0, 'XL'],
  ] as const)('buckets %d additions + %d deletions as size %s', async (additions, deletions, size) => {
    mockPull(additions, deletions, 1);
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', {}, 404);
    mockRest('post', '/repos/acme/widgets/labels', {});
    mockRest('get', `/repos/acme/widgets/labels/size%3A${size}`, {}, 404);
    mockRest('post', '/repos/acme/widgets/issues/1/labels', {});

    const result = await classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat' }, fastDeps);
    expect(result.size).toBe(size);
    expect(result.changedLines).toBe(additions + deletions);
  });

  it('creates missing labels then applies them additively', async () => {
    mockPull(5, 0, 1);
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', {}, 404);
    mockRest('get', '/repos/acme/widgets/labels/size%3AXS', {}, 404);
    mockRest('get', '/repos/acme/widgets/labels/risk%3Alow', {}, 404);
    mockRest('post', '/repos/acme/widgets/labels', {});
    mockRest('post', '/repos/acme/widgets/issues/1/labels', {});

    const result = await classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat', risk: 'low' }, fastDeps);
    expect(result.labelsApplied.sort()).toEqual(['risk:low', 'size:XS', 'type:feat'].sort());
  });

  it('reuses an existing label without recreating it', async () => {
    mockPull(5, 0, 1);
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', { name: 'type:feat' }, 200);
    mockRest('get', '/repos/acme/widgets/labels/size%3AXS', { name: 'size:XS' }, 200);
    mockRest('post', '/repos/acme/widgets/issues/1/labels', {});

    const result = await classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat' }, fastDeps);
    expect(result.labelsApplied).toEqual(['type:feat', 'size:XS']);
  });

  it('Edge Case: replaces a stale same-category label instead of accumulating it', async () => {
    mockPull(500, 0, 1, ['size:S', 'type:fix', 'unrelated-label']);
    mockRest('delete', '/repos/acme/widgets/issues/1/labels/size%3AS', {});
    mockRest('delete', '/repos/acme/widgets/issues/1/labels/type%3Afix', {});
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', {}, 404);
    mockRest('get', '/repos/acme/widgets/labels/size%3AXL', {}, 404);
    mockRest('post', '/repos/acme/widgets/labels', {});
    mockRest('post', '/repos/acme/widgets/issues/1/labels', {});

    const result = await classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat' }, fastDeps);
    expect(result.labelsRemoved.sort()).toEqual(['size:S', 'type:fix'].sort());
    expect(result.labelsApplied).toEqual(['type:feat', 'size:XL']);
  });

  it('Edge Case: does not touch an unrelated (non type:/size:/risk:) label', async () => {
    mockPull(0, 0, 0, ['unrelated-label']);
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', {}, 404);
    mockRest('get', '/repos/acme/widgets/labels/size%3AXS', {}, 404);
    mockRest('post', '/repos/acme/widgets/labels', {});
    mockRest('post', '/repos/acme/widgets/issues/1/labels', {});

    const result = await classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat' }, fastDeps);
    expect(result.labelsRemoved).toEqual([]);
  });

  it('Edge Case: a non-404 failure checking label existence propagates, is not swallowed as not-found', async () => {
    mockPull(0, 0, 0);
    mockRest('get', '/repos/acme/widgets/labels/type%3Afeat', { message: 'Internal Server Error' }, 500);

    await expect(classifyPullRequest({ owner: 'acme', repo: 'widgets', pullNumber: 1, type: 'feat' }, fastDeps)).rejects.toMatchObject({
      code: 'github_api_error',
      details: { status: 500 },
    });
  });
});
