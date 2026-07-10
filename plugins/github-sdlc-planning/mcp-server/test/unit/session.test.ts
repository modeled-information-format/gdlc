import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { mockRest, mockGraphQL } from '../helpers.js';
import { getSessionContext, getAgentCapabilities } from '../../src/tools/session.js';

// Same isolate()/chdir() pattern as tool-defaults.test.ts: projectConfigPath
// (Copilot review finding on #106) is computed via resolveProjectConfigPath(),
// which consults the real filesystem from the real cwd -- deterministic
// coverage needs a real, isolated tmp cwd, not a mock.
function tmpProjectWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-session-'));
  if (contents !== null) {
    const gdlcDir = join(dir, '.config', 'gdlc');
    mkdirSync(gdlcDir, { recursive: true });
    writeFileSync(join(gdlcDir, 'config.yml'), contents);
  }
  return dir;
}

const originalCwd = process.cwd();
const originalXdg = process.env.XDG_CONFIG_HOME;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
});

function isolate(projectRoot: string): void {
  process.chdir(projectRoot);
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'gdlc-session-empty-global-'));
}

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
  it('returns open milestones (including due date) without a project board when none is requested', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', [
      { number: 1, title: 'Sprint 1', html_url: 'https://x/1', due_on: '2026-07-10T00:00:00Z' },
    ]);
    const ctx = await getSessionContext({ owner: 'acme', repo: 'widgets' });
    expect(ctx.openMilestones).toEqual([{ number: 1, title: 'Sprint 1', url: 'https://x/1', dueOn: '2026-07-10T00:00:00Z' }]);
    expect(ctx.projectBoard).toBeNull();
  });

  it('includes project board state when a project is specified', async () => {
    mockRest('get', '/repos/acme/widgets/milestones', []);
    mockGraphQL((body) => {
      if (body.query.includes('projectV2(number')) return { organization: { projectV2: { id: 'PVT_1' } } };
      return { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } };
    });
    const ctx = await getSessionContext({
      owner: 'acme',
      repo: 'widgets',
      projectOwnerLogin: 'acme',
      projectNumber: 4,
    });
    expect(ctx.projectBoard).toEqual({ items: [] });
  });

  it('Copilot review finding: projectConfigPath reports the resolved project-layer config path', async () => {
    isolate(tmpProjectWith('destination:\n  repo: "acme/widgets"\n'));
    mockRest('get', '/repos/acme/widgets/milestones', []);

    const ctx = await getSessionContext({ owner: 'acme', repo: 'widgets' });

    // Derived from process.cwd() itself (post-chdir), not the pre-chdir
    // tmp path string -- macOS resolves /var as a symlink to /private/var,
    // so process.cwd() and a plain path.resolve() of the original string
    // can legitimately disagree textually while naming the same directory.
    expect(ctx.projectConfigPath).toBe(join(process.cwd(), '.config', 'gdlc', 'config.yml'));
  });

  it('Copilot review finding: projectConfigPath is null when no project-layer config is reachable', async () => {
    const projectRoot = tmpProjectWith(null);
    isolate(projectRoot);
    mockRest('get', '/repos/acme/widgets/milestones', []);

    const ctx = await getSessionContext({ owner: 'acme', repo: 'widgets' });

    expect(ctx.projectConfigPath).toBeNull();
  });
});
