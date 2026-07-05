/** Feature detection for any MCP host, mirroring github-sdlc-planning's
 * get_agent_capabilities: a host (or a sibling plugin's composition check)
 * reads this instead of probing tools one by one. The Layer 1 core tools
 * (epic #28) and the lifecycle tools (epic #33) are both here; Layer 2 pack
 * tools (epic #38) append to `tools` as they land. */

export interface AgentCapabilities {
  plugin: string;
  tools: string[];
  mifConformance: 'L1';
  /** Consumed capabilities, per ADR-0002: linkage comes from
   * github-pull-requests, planning/board governance from
   * github-sdlc-planning — this plugin does not reimplement either. */
  composesWith: string[];
  hooksSupported: boolean;
}

export function getAgentCapabilities(): AgentCapabilities {
  return {
    plugin: 'github-bug-capture',
    tools: [
      'get_agent_capabilities',
      'ensure_severity_field',
      'set_severity',
      'get_lifecycle_state',
      'set_lifecycle_state',
      'search_similar_issues',
      'close_as_duplicate',
    ],
    mifConformance: 'L1',
    composesWith: ['github-pull-requests', 'github-sdlc-planning'],
    hooksSupported: false,
  };
}
