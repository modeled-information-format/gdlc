import { describe, expect, it } from 'vitest';
import { getAgentCapabilities } from '../../src/capabilities.js';

describe('getAgentCapabilities', () => {
  it('names this plugin', () => {
    expect(getAgentCapabilities().plugin).toBe('github-bug-capture');
  });

  it('lists every registered tool exactly once', () => {
    const { tools } = getAgentCapabilities();
    expect(tools).toContain('get_agent_capabilities');
    expect(new Set(tools).size).toBe(tools.length);
  });

  it('declares MIF L1 conformance', () => {
    expect(getAgentCapabilities().mifConformance).toBe('L1');
  });

  it('declares the ADR-0002 composition boundary: consumes linkage and planning, never reimplements them', () => {
    const { composesWith, tools } = getAgentCapabilities();
    expect(composesWith).toEqual(['github-pull-requests', 'github-sdlc-planning']);
    // Owned elsewhere per ADR-0001/0002 — this surface must never grow them.
    for (const foreign of ['get_linked_issues', 'create_milestone', 'add_item_to_project']) {
      expect(tools).not.toContain(foreign);
    }
  });

  it('does not claim hook support before the hooks-pack exists', () => {
    expect(getAgentCapabilities().hooksSupported).toBe(false);
  });
});
