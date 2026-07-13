import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withRequiredBoardCoordinates } from '../../src/tool-defaults.js';
import { isBugCaptureError } from '../../src/errors.js';

function tmpProjectWith(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'bug-capture-tool-defaults-'));
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
  const dir = mkdtempSync(join(tmpdir(), 'bug-capture-tool-defaults-global-'));
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
    isolate(tmpProjectWith(null), tmpProjectWith(null));
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number; owner: string }) => args);
    const result = await fn({ projectOwnerLogin: 'acme', projectNumber: 1, owner: 'acme' });
    expect(result).toEqual({ projectOwnerLogin: 'acme', projectNumber: 1, owner: 'acme' });
  });

  it('fills board coordinates from the project config when omitted', async () => {
    isolate(
      tmpProjectWith(['board:', '  projectOwnerLogin: from-project', '  projectNumber: 7', ''].join('\n')),
      tmpProjectWith(null),
    );
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'from-project', projectNumber: 7 });
  });

  it('falls back to the global config when the project has none', async () => {
    isolate(tmpProjectWith(null), tmpGlobalWith(['board:', '  projectOwnerLogin: from-global', '  projectNumber: 4', ''].join('\n')));
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'from-global', projectNumber: 4 });
  });

  it('throws missing_board_config when nothing resolves', async () => {
    isolate(tmpProjectWith(null), tmpProjectWith(null));
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    let threw = false;
    try {
      await fn({});
    } catch (err) {
      threw = true;
      expect(isBugCaptureError(err)).toBe(true);
      expect(isBugCaptureError(err) && err.code).toBe('missing_board_config');
    }
    expect(threw).toBe(true);
  });

  // Issue #281: same root cause as gdlc#274/#280 -- this plugin's own
  // withRequiredBoardCoordinates ignored startDir entirely and always read
  // process.cwd(), unrelated to whichever repo a tool call concerns.
  it('issue #281: resolves board coordinates from startDir, not process.cwd(), when startDir is given', async () => {
    const cwdRoot = tmpProjectWith(null); // cwd itself has NO board configured
    const otherRoot = tmpProjectWith(['board:', '  projectOwnerLogin: from-startdir', '  projectNumber: 9', ''].join('\n'));
    isolate(cwdRoot, tmpProjectWith(null));
    const fn = withRequiredBoardCoordinates(
      (args: { projectOwnerLogin: string; projectNumber: number; startDir?: string }) => args,
    );
    expect(await fn({ startDir: otherRoot })).toEqual({
      projectOwnerLogin: 'from-startdir',
      projectNumber: 9,
      startDir: otherRoot,
    });
  });

  it('issue #281: still resolves from process.cwd() when startDir is omitted (backward compatible)', async () => {
    isolate(
      tmpProjectWith(['board:', '  projectOwnerLogin: from-cwd', '  projectNumber: 3', ''].join('\n')),
      tmpProjectWith(null),
    );
    const fn = withRequiredBoardCoordinates((args: { projectOwnerLogin: string; projectNumber: number }) => args);
    expect(await fn({})).toEqual({ projectOwnerLogin: 'from-cwd', projectNumber: 3 });
  });
});
