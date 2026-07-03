import { describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { getSessionContext, getAgentCapabilities } from '../../src/tools/session.js';

describe('getAgentCapabilities', () => {
  it('AC-10: describes the full tool surface with zero Claude-Code-specific state', () => {
    const caps = getAgentCapabilities();
    expect(caps.hooksSupported).toBe(false);
    expect(caps.mifConformance).toBe('L1');
    expect(caps.tools).toContain('create_issue');
    expect(caps.tools).toContain('get_session_context');
    expect(caps.tools).toHaveLength(16);
  });
});

describe('getSessionContext', () => {
  it('returns open milestones without a project board when none is requested', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', [{ number: 1, title: 'Sprint 1', html_url: 'https://x/1' }]);
    const ctx = await getSessionContext({ owner: 'acme', repo: 'widgets' });
    expect(ctx.openMilestones).toEqual([{ number: 1, title: 'Sprint 1', url: 'https://x/1' }]);
    expect(ctx.projectBoard).toBeNull();
  });

  it('includes project board state when a project is specified', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', []);
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return { node: { items: { nodes: [] } } };
    });
    const ctx = await getSessionContext({
      owner: 'acme',
      repo: 'widgets',
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });
    expect(ctx.projectBoard).toEqual({ items: [] });
  });
});
