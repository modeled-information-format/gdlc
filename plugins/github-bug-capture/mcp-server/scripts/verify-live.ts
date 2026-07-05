#!/usr/bin/env tsx
/**
 * Live verification script: exercises the real src/ implementation, not a
 * mock. Not part of the CI-gating `npm test` suite — invoked manually.
 *
 * At scaffold stage the surface is feature detection only; this script
 * asserts the capabilities contract that sibling plugins and MCP hosts
 * rely on. The Layer 1 core (epic #28) and lifecycle tools (epic #33)
 * extend this script as they extend the surface, and the composition
 * check against github-sdlc-planning / github-pull-requests (issue #48)
 * lands with the full stack.
 */
import { getAgentCapabilities } from '../src/capabilities.js';

let failed = false;
function assert(condition: boolean, message: string): void {
  if (condition) {
    process.stdout.write(`  OK   ${message}\n`);
  } else {
    failed = true;
    process.stdout.write(`  FAIL ${message}\n`);
  }
}
function step(name: string): void {
  process.stdout.write(`\n=== ${name} ===\n`);
}

function main(): void {
  step('get_agent_capabilities');
  const caps = getAgentCapabilities();
  assert(caps.plugin === 'github-bug-capture', 'identifies itself as github-bug-capture');
  assert(caps.tools.includes('get_agent_capabilities'), 'advertises its own feature-detection tool');
  assert(
    caps.tools.includes('ensure_severity_field') && caps.tools.includes('set_severity'),
    'advertises the Layer 1 triage-board tools',
  );
  assert(caps.mifConformance === 'L1', 'declares MIF L1 conformance');
  assert(
    caps.composesWith.includes('github-pull-requests') && caps.composesWith.includes('github-sdlc-planning'),
    'declares the ADR-0002 composition boundary',
  );

  process.stdout.write(failed ? '\nverify:live FAILED\n' : '\nverify:live passed\n');
  process.exitCode = failed ? 1 : 0;
}

main();
