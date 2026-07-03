import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { createDiscussion, listDiscussions } from '../../src/tools/discussions.js';

describe('createDiscussion', () => {
  it('AC-6: maps to createDiscussion with resolved repositoryId + categoryId', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    let capturedVars: Record<string, unknown> = {};
    mockGraphQL((body) => {
      if (body.query.includes('discussionCategories')) {
        return { repository: { discussionCategories: { nodes: [{ id: 'DIC_announcements', name: 'Announcements' }] } } };
      }
      capturedVars = body.variables;
      return { createDiscussion: { discussion: { id: 'D_1', number: 1, title: 'Roadmap', url: 'https://x' } } };
    });

    const result = await createDiscussion({
      owner: 'acme',
      repo: 'widgets',
      categoryName: 'Announcements',
      title: 'Roadmap',
      body: 'Here is the plan.',
    });

    expect(capturedVars.repositoryId).toBe('R_1');
    expect(capturedVars.categoryId).toBe('DIC_announcements');
    expect(result.id).toBe('D_1');
  });

  it('surfaces an unknown category name with the available options, not a raw GraphQL error', async () => {
    mockRest('get', '/repos/acme/widgets', { node_id: 'R_1' });
    mockGraphQL(() => ({ repository: { discussionCategories: { nodes: [{ id: 'DIC_1', name: 'Q&A' }] } } }));
    await expect(
      createDiscussion({ owner: 'acme', repo: 'widgets', categoryName: 'Nonexistent', title: 'X', body: 'Y' }),
    ).rejects.toMatchObject({ code: 'github_api_error', details: { available: ['Q&A'] } });
  });
});

describe('listDiscussions', () => {
  it('lists discussions with their category name', async () => {
    mockGraphQL(() => ({
      repository: {
        discussions: {
          nodes: [{ id: 'D_1', number: 1, title: 'RFC: new field', url: 'https://x', category: { name: 'Ideas' } }],
        },
      },
    }));
    const result = await listDiscussions({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual([{ id: 'D_1', number: 1, title: 'RFC: new field', url: 'https://x', category: 'Ideas' }]);
  });
});
