import { describe, it, expect } from 'vitest';
import { mockRest } from '../helpers.js';
import { createMilestone, listMilestones, assignMilestone } from '../../src/tools/milestones.js';

describe('milestones (REST-only surface)', () => {
  it('creates a milestone', async () => {
    mockRest('post', '/repos/acme/widgets/milestones', {
      number: 3,
      title: 'Sprint 4',
      html_url: 'https://github.com/acme/widgets/milestone/3',
      due_on: '2026-08-01T00:00:00Z',
    });
    const result = await createMilestone({ owner: 'acme', repo: 'widgets', title: 'Sprint 4' });
    expect(result).toEqual({
      number: 3,
      title: 'Sprint 4',
      url: 'https://github.com/acme/widgets/milestone/3',
      dueOn: '2026-08-01T00:00:00Z',
    });
  });

  it('lists open milestones by default, including each milestone\'s due date', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', [
      { number: 1, title: 'Sprint 1', html_url: 'https://x/1', due_on: '2026-07-10T00:00:00Z' },
      { number: 2, title: 'Sprint 2', html_url: 'https://x/2', due_on: null },
    ]);
    const result = await listMilestones({ owner: 'acme', repo: 'widgets' });
    expect(result).toEqual([
      { number: 1, title: 'Sprint 1', url: 'https://x/1', dueOn: '2026-07-10T00:00:00Z' },
      { number: 2, title: 'Sprint 2', url: 'https://x/2', dueOn: null },
    ]);
  });

  it('lists milestones with an explicit state filter', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', [
      { number: 1, title: 'Done sprint', html_url: 'https://x/1', due_on: null },
    ]);
    const result = await listMilestones({ owner: 'acme', repo: 'widgets', state: 'all' });
    expect(result).toHaveLength(1);
  });

  it('assigns and unassigns (null) a milestone', async () => {
    mockRest('patch', '/repos/acme/widgets/issues/5', {});
    const assigned = await assignMilestone({ owner: 'acme', repo: 'widgets', issueNumber: 5, milestoneNumber: 3 });
    expect(assigned).toEqual({ issueNumber: 5, milestoneNumber: 3 });

    mockRest('patch', '/repos/acme/widgets/issues/5', {});
    const unassigned = await assignMilestone({ owner: 'acme', repo: 'widgets', issueNumber: 5, milestoneNumber: null });
    expect(unassigned).toEqual({ issueNumber: 5, milestoneNumber: null });
  });
});
