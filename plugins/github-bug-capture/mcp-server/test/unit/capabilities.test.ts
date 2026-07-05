import { describe, expect, it } from 'vitest';
import { getAgentCapabilities } from '../../src/capabilities.js';

describe('getAgentCapabilities', () => {
  it('names this plugin', () => {
    expect(getAgentCapabilities().plugin).toBe('github-bug-capture');
  });

  it('lists every registered tool exactly once', () => {
    const { tools } = getAgentCapabilities();
    expect(tools).toContain('get_agent_capabilities');
    expect(tools).toContain('ensure_severity_field');
    expect(tools).toContain('set_severity');
    expect(tools).toContain('get_lifecycle_state');
    expect(tools).toContain('set_lifecycle_state');
    expect(tools).toContain('search_similar_issues');
    expect(tools).toContain('close_as_duplicate');
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

  it('claims hook support now that the hooks-pack (epic #38) exists', () => {
    expect(getAgentCapabilities().hooksSupported).toBe(true);
  });
});
