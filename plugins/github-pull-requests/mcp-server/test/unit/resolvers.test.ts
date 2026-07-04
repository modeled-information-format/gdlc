import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { resolveRepositoryId, resolvePullRequestNodeId } from '../../src/resolvers.js';

describe('resolveRepositoryId', () => {
  it('resolves the node_id from the REST repository response', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    await expect(resolveRepositoryId('acme', 'widgets')).resolves.toBe('R_1');
  });

  it('Edge Case: wraps a missing node_id as resolve_id_failed', async () => {
    mockRest('get', '/repos/acme/widgets', {});
    await expect(resolveRepositoryId('acme', 'widgets')).rejects.toMatchObject({
      code: 'resolve_id_failed',
      details: { lookupStep: 'resolve_repository_id' },
    });
  });

  it('Edge Case: stringifies a non-Error cause rather than assuming .message exists', async () => {
    await expect(
      resolveRepositoryId('acme', 'widgets', { fetchImpl: () => Promise.reject('raw string failure') }),
    ).rejects.toMatchObject({ code: 'resolve_id_failed', details: { cause: 'raw string failure' } });
  });
});

describe('resolvePullRequestNodeId', () => {
  it('resolves the node_id from the REST pull request response', async () => {
    mockRest('get', '/repos/acme/widgets/pulls/5', { node_id: 'PR_5' });
    await expect(resolvePullRequestNodeId('acme', 'widgets', 5)).resolves.toBe('PR_5');
  });

  it('Edge Case: stringifies a non-Error cause rather than assuming .message exists', async () => {
    await expect(
      resolvePullRequestNodeId('acme', 'widgets', 5, { fetchImpl: () => Promise.reject('raw string failure') }),
    ).rejects.toMatchObject({ code: 'resolve_id_failed', details: { cause: 'raw string failure' } });
  });
});
