import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  withRequiredBoardCoordinates,
  withOptionalBoardCoordinates,
  withIssueDestination,
  warnNoOpBoard,
  resetNoOpBoardWarning,
} from '../../src/tool-defaults.js';
import { isPlanningError } from '../../src/errors.js';

function tmpProjectWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-tool-defaults-'));
  if (contents !== null) {
    // Project layer lives at <dir>/.config/gdlc/config.yml (this becomes
    // the process cwd via isolate()); tmpGlobalWith below writes the global
    // layer directly at <root>/gdlc/config.yml, since XDG_CONFIG_HOME IS
    // the .config root already.
    const gdlcDir = join(dir, '.config', 'gdlc');
    mkdirSync(gdlcDir, { recursive: true });
    writeFileSync(join(gdlcDir, 'config.yml'), contents);
  }
  return dir;
}

function tmpGlobalWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'gdlc-tool-defaults-global-'));
  if (contents !== null) {
    const gdlcDir = join(dir, 'gdlc');
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

function isolate(projectRoot: string, globalRoot: string): void {
  process.chdir(projectRoot);
  process.env.XDG_CONFIG_HOME = globalRoot;
}

describe('withRequiredBoardCoordinates', () => {
  it('passes explicit board coordinates through unchanged', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number; owner: string }) => args);
    const result = await fn({ projectOwnerLogin: 'acme', projectNumber: 1, owner: 'acme' });
    expect(result).toEqual({ projectOwnerLogin: 'acme', projectNumber: 1, owner: 'acme' });
  });

  it('fills board coordinates from the project config when omitted', async () => {
    isolate(
      tmpProjectWith(['board:', '  projectOwnerLogin: from-project', '  projectNumber: 7', ''].join('\n')),
      tmpGlobalWith(null),
    );
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'from-project', projectNumber: 7 });
  });

  it('throws missing_board_config when nothing resolves', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    let threw = false;
    try {
      await fn({});
    } catch (err) {
      threw = true;
      expect(isPlanningError(err)).toBe(true);
      expect(isPlanningError(err) && err.code).toBe('missing_board_config');
    }
    expect(threw).toBe(true);
  });
});

describe('withOptionalBoardCoordinates', () => {
  afterEach(() => resetNoOpBoardWarning());

  it('fills board coordinates from config when available', async () => {
    isolate(tmpProjectWith(['board:', '  projectOwnerLogin: acme', '  projectNumber: 2', ''].join('\n')), tmpGlobalWith(null));
    const fn = withOptionalBoardCoordinates((args: { projectOwnerLogin?: string; projectNumber?: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'acme', projectNumber: 2 });
  });

  it('passes args through unchanged (no throw) when nothing resolves', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const fn = withOptionalBoardCoordinates((args: { owner: string }) => args);
    expect(await fn({ owner: 'acme' })).toEqual({ owner: 'acme' });
  });

  it('does not warn when board coordinates resolve from config', async () => {
    isolate(tmpProjectWith(['board:', '  projectOwnerLogin: acme', '  projectNumber: 2', ''].join('\n')), tmpGlobalWith(null));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const fn = withOptionalBoardCoordinates((args: { projectOwnerLogin?: string; projectNumber?: number }) => args);
      await fn({});
      expect(stderrSpy).not.toHaveBeenCalled();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('warns on stderr, once, when nothing resolves across repeated calls', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const fn = withOptionalBoardCoordinates((args: { owner: string }) => args);
      expect(await fn({ owner: 'acme' })).toEqual({ owner: 'acme' });
      expect(await fn({ owner: 'acme' })).toEqual({ owner: 'acme' });
      expect(stderrSpy).toHaveBeenCalledTimes(1);
      expect(stderrSpy.mock.calls[0]?.[0]).toContain('No board configured');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  // Issue #274: get_session_context (the only caller of this wrapper) took
  // `owner`/`repo` describing a target repo, but board-config resolution
  // ignored both and read from process.cwd() -- the MCP SERVER's own
  // working directory, unrelated to whichever repo a caller asked about.
  // A caller with no explicit projectOwnerLogin/projectNumber silently got
  // whatever board the server process's cwd happened to configure, with no
  // error and no diagnostic. startDir closes this: when given, resolution
  // must read THAT directory's config, not process.cwd()'s.
  it('issue #274: resolves board coordinates from startDir, not process.cwd(), when startDir is given', async () => {
    const cwdRoot = tmpProjectWith(null); // cwd itself has NO board configured
    const otherRoot = tmpProjectWith(['board:', '  projectOwnerLogin: from-startdir', '  projectNumber: 9', ''].join('\n'));
    isolate(cwdRoot, tmpGlobalWith(null));
    const fn = withOptionalBoardCoordinates(
      (args: { projectOwnerLogin?: string; projectNumber?: number; startDir?: string }) => args,
    );
    expect(await fn({ startDir: otherRoot })).toEqual({
      projectOwnerLogin: 'from-startdir',
      projectNumber: 9,
      startDir: otherRoot,
    });
  });

  it('issue #274: still resolves from process.cwd() when startDir is omitted (backward compatible)', async () => {
    isolate(
      tmpProjectWith(['board:', '  projectOwnerLogin: from-cwd', '  projectNumber: 3', ''].join('\n')),
      tmpGlobalWith(null),
    );
    const fn = withOptionalBoardCoordinates((args: { projectOwnerLogin?: string; projectNumber?: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'from-cwd', projectNumber: 3 });
  });
});

describe('warnNoOpBoard', () => {
  afterEach(() => resetNoOpBoardWarning());

  it('writes a diagnostic naming the no-op and how to configure it', () => {
    const lines: string[] = [];
    warnNoOpBoard((line) => lines.push(line));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('No board configured');
    expect(lines[0]).toContain('.config/gdlc/config.yml');
    expect(lines[0]).toContain('projectOwnerLogin');
    expect(lines[0]).toContain('projectNumber');
  });

  it('fires only once per process, not on every call', () => {
    const lines: string[] = [];
    warnNoOpBoard((line) => lines.push(line));
    warnNoOpBoard((line) => lines.push(line));
    warnNoOpBoard((line) => lines.push(line));
    expect(lines).toHaveLength(1);
  });

  it('resetNoOpBoardWarning allows it to fire again (test isolation only)', () => {
    const lines: string[] = [];
    warnNoOpBoard((line) => lines.push(line));
    resetNoOpBoardWarning();
    warnNoOpBoard((line) => lines.push(line));
    expect(lines).toHaveLength(2);
  });
});

describe('withIssueDestination', () => {
  it('passes explicit owner/repo through when no targeting is configured', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const fn = withIssueDestination((args: { owner: string; repo: string }) => args);
    expect(await fn({ owner: 'acme', repo: 'widgets' })).toEqual({ owner: 'acme', repo: 'widgets' });
  });

  it('fills owner/repo from destination.repo when omitted', async () => {
    isolate(tmpProjectWith(['destination:', '  repo: "acme/central"', ''].join('\n')), tmpGlobalWith(null));
    const fn = withIssueDestination((args: { owner: string; repo: string }) => args);
    expect(await fn({})).toEqual({ owner: 'acme', repo: 'central' });
  });

  it('throws missing_destination when owner/repo are omitted and no destination is configured', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(null));
    const fn = withIssueDestination((args: { owner: string; repo: string }) => args);
    let threw = false;
    try {
      await fn({});
    } catch (err) {
      threw = true;
      expect(isPlanningError(err)).toBe(true);
      expect(isPlanningError(err) && err.code).toBe('missing_destination');
    }
    expect(threw).toBe(true);
  });

  it('throws repo_not_allowed when the resolved repo is outside a configured allowlist', async () => {
    isolate(tmpProjectWith(['targeting:', '  allowRepos: ["acme/widgets"]', ''].join('\n')), tmpGlobalWith(null));
    const fn = withIssueDestination((args: { owner: string; repo: string }) => args);
    let threw = false;
    try {
      await fn({ owner: 'acme', repo: 'gadgets' });
    } catch (err) {
      threw = true;
      expect(isPlanningError(err)).toBe(true);
      expect(isPlanningError(err) && err.code).toBe('repo_not_allowed');
    }
    expect(threw).toBe(true);
  });

  it('allows a repo present in a configured allowlist', async () => {
    isolate(tmpProjectWith(['targeting:', '  allowRepos: ["acme/widgets"]', ''].join('\n')), tmpGlobalWith(null));
    const fn = withIssueDestination((args: { owner: string; repo: string }) => args);
    expect(await fn({ owner: 'acme', repo: 'widgets' })).toEqual({ owner: 'acme', repo: 'widgets' });
  });
});
