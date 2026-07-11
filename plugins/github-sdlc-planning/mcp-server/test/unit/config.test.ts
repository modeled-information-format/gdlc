import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveConfigPath,
  resolveGlobalConfigRoot,
  loadConfigFile,
  mergeConfigs,
  loadGdlcConfig,
  findProjectConfigRoot,
  findAllProjectConfigPaths,
  resolveProjectConfigPath,
  resolveBoardCoordinates,
  resolveDestinationRepo,
  isRepoAllowed,
  isPackEnabled,
  resolvePrLifecycleConfig,
} from '../../src/config.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-config-'));
}

function writeConfig(root: string, contents: string): void {
  const dir = join(root, 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
}

describe('resolveConfigPath', () => {
  it('joins root with gdlc/config.yml', () => {
    expect(resolveConfigPath('/some/root')).toBe(join('/some/root', 'gdlc', 'config.yml'));
  });
});

describe('resolveGlobalConfigRoot', () => {
  it('uses XDG_CONFIG_HOME when set', () => {
    expect(resolveGlobalConfigRoot({ XDG_CONFIG_HOME: '/xdg/config' })).toBe('/xdg/config');
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is unset', () => {
    expect(resolveGlobalConfigRoot({})).toBe(join(homedir(), '.config'));
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is empty', () => {
    expect(resolveGlobalConfigRoot({ XDG_CONFIG_HOME: '' })).toBe(join(homedir(), '.config'));
  });
});

describe('loadConfigFile', () => {
  it('returns an empty config when the file is missing', () => {
    expect(loadConfigFile(join(tmpDir(), 'gdlc', 'config.yml'))).toEqual({});
  });

  it('returns an empty config on a YAML syntax error', () => {
    const root = tmpDir();
    writeConfig(root, 'targeting: [1, 2');
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });

  it('returns an empty config when the document is not a map (e.g. a bare scalar)', () => {
    const root = tmpDir();
    writeConfig(root, 'just a string\n');
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });

  it('parses a full valid config', () => {
    const root = tmpDir();
    writeConfig(
      root,
      [
        'targeting:',
        '  allowRepos: ["acme/widgets"]',
        '  allowOrgs: ["acme"]',
        'destination:',
        '  repo: "acme/central"',
        'board:',
        '  projectOwnerLogin: acme',
        '  projectNumber: 3',
        '  projectOwnerType: organization',
        'packs:',
        '  hooks: true',
        '  gh-aw: false',
        '',
      ].join('\n'),
    );
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({
      targeting: { allowRepos: ['acme/widgets'], allowOrgs: ['acme'] },
      destination: { repo: 'acme/central' },
      board: { projectOwnerLogin: 'acme', projectNumber: 3, projectOwnerType: 'organization' },
      packs: { hooks: true, 'gh-aw': false },
    });
  });

  it('ADR-0006: drops non-boolean packs entries rather than throwing', () => {
    const root = tmpDir();
    writeConfig(root, ['packs:', '  hooks: "yes"', '  gh-aw: false', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ packs: { 'gh-aw': false } });
  });

  it('ADR-0006: omits packs entirely when every entry is malformed', () => {
    const root = tmpDir();
    writeConfig(root, ['packs:', '  hooks: "yes"', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });

  it('drops unrecognized targeting/destination/board fields rather than throwing', () => {
    const root = tmpDir();
    writeConfig(
      root,
      [
        'targeting:',
        '  allowRepos: "not-an-array"',
        'destination:',
        '  repo: 12345',
        'board:',
        '  projectOwnerLogin: ""',
        '  projectNumber: -1',
        '  projectOwnerType: superuser',
        '',
      ].join('\n'),
    );
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });

  it('keeps an explicitly empty allowlist array (no restriction) distinct from an absent one', () => {
    const root = tmpDir();
    writeConfig(root, ['targeting:', '  allowRepos: []', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ targeting: { allowRepos: [] } });
  });

  it('coerces non-string scalar entries in allowlist arrays to strings rather than dropping them', () => {
    const root = tmpDir();
    writeConfig(root, ['targeting:', '  allowRepos: ["acme/widgets", 42, "acme/gadgets"]', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({
      targeting: { allowRepos: ['acme/widgets', '42', 'acme/gadgets'] },
    });
  });

  it('coerces an unquoted boolean entry instead of silently emptying the allowlist', () => {
    const root = tmpDir();
    // Unquoted `false` parses as the YAML 1.2 boolean, not the string
    // "false" -- a plausible authoring slip if an org/repo name happened to
    // look boolean-ish. Dropping it would leave allowOrgs: [] (== "no
    // restriction" to isRepoAllowed); coercing to "false" keeps the list
    // non-empty so the allowlist still restricts, just not to what the
    // author probably meant.
    writeConfig(root, ['targeting:', '  allowOrgs: [false]', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ targeting: { allowOrgs: ['false'] } });
  });

  it('coerces non-scalar entries (objects/arrays/null) rather than dropping them', () => {
    const root = tmpDir();
    writeConfig(root, ['targeting:', '  allowRepos: ["acme/widgets", null, {a: 1}]', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({
      targeting: { allowRepos: ['acme/widgets', 'null', '[object Object]'] },
    });
  });

  it('never normalizes a non-empty allowlist down to [] even when every entry is non-scalar', () => {
    // If every entry had been dropped instead of coerced, this would
    // normalize to allowRepos: [], which isRepoAllowed treats as "no
    // restriction" -- the opposite of what a fully-non-scalar allowlist
    // (almost certainly a config-authoring mistake) should do.
    const root = tmpDir();
    writeConfig(root, ['targeting:', '  allowRepos: [null, {a: 1}]', ''].join('\n'));
    const config = loadConfigFile(resolveConfigPath(root));
    expect(config.targeting?.allowRepos).toHaveLength(2);
    expect(isRepoAllowed(config, 'acme', 'widgets')).toBe(false);
  });

  it('accepts a quoted numeric string for board.projectNumber, matching the hooks-layer reader', () => {
    const root = tmpDir();
    writeConfig(root, ['board:', '  projectOwnerLogin: acme', '  projectNumber: "4"', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ board: { projectOwnerLogin: 'acme', projectNumber: 4 } });
  });

  it('ignores a non-object board/targeting/destination section', () => {
    const root = tmpDir();
    writeConfig(root, ['board: "not-a-map"', 'targeting: 5', 'destination: [1,2]', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });
});

describe('mergeConfigs', () => {
  it('takes project section wholly over global when both define it', () => {
    const global = { targeting: { allowRepos: ['acme/global'] }, board: { projectOwnerLogin: 'g', projectNumber: 1 } };
    const project = { targeting: { allowRepos: ['acme/project'] } };
    expect(mergeConfigs(global, project)).toEqual({
      targeting: { allowRepos: ['acme/project'] },
      board: { projectOwnerLogin: 'g', projectNumber: 1 },
    });
  });

  it('returns an empty config when neither layer defines anything', () => {
    expect(mergeConfigs({}, {})).toEqual({});
  });

  it('falls back to global when project omits a section entirely', () => {
    const global = { destination: { repo: 'acme/central' } };
    expect(mergeConfigs(global, {})).toEqual({ destination: { repo: 'acme/central' } });
  });

  it('takes project targeting alone when global has none', () => {
    const project = { targeting: { allowOrgs: ['acme'] } };
    expect(mergeConfigs({}, project)).toEqual({ targeting: { allowOrgs: ['acme'] } });
  });

  it('falls back to global targeting alone when project has none', () => {
    const global = { targeting: { allowOrgs: ['acme'] } };
    expect(mergeConfigs(global, {})).toEqual({ targeting: { allowOrgs: ['acme'] } });
  });

  it('takes project board alone when global has none', () => {
    const project = { board: { projectOwnerLogin: 'acme', projectNumber: 2 } };
    expect(mergeConfigs({}, project)).toEqual({ board: { projectOwnerLogin: 'acme', projectNumber: 2 } });
  });

  it('falls back to global board alone when project has none', () => {
    const global = { board: { projectOwnerLogin: 'acme', projectNumber: 2 } };
    expect(mergeConfigs(global, {})).toEqual({ board: { projectOwnerLogin: 'acme', projectNumber: 2 } });
  });

  it('ADR-0006: takes project packs wholly over global when both define it', () => {
    const global = { packs: { hooks: true, 'gh-aw': true } };
    const project = { packs: { 'triage-skills': true } };
    expect(mergeConfigs(global, project)).toEqual({ packs: { 'triage-skills': true } });
  });
});

describe('loadGdlcConfig', () => {
  it('merges the global and project files by section', () => {
    const globalRoot = tmpDir();
    const projectRoot = tmpDir();
    writeConfig(globalRoot, ['board:', '  projectOwnerLogin: acme', '  projectNumber: 1', ''].join('\n'));
    // The project layer lives under <projectRoot>/.config/gdlc/config.yml,
    // not <projectRoot>/gdlc/config.yml -- the global root ($XDG_CONFIG_HOME)
    // already points at what .config conceptually is for that layer.
    writeConfig(join(projectRoot, '.config'), ['destination:', '  repo: "acme/central"', ''].join('\n'));

    const config = loadGdlcConfig(projectRoot, { XDG_CONFIG_HOME: globalRoot });
    expect(config).toEqual({
      board: { projectOwnerLogin: 'acme', projectNumber: 1 },
      destination: { repo: 'acme/central' },
    });
  });

  it('prefers the project file over the global file for the same section', () => {
    const globalRoot = tmpDir();
    const projectRoot = tmpDir();
    writeConfig(globalRoot, ['board:', '  projectOwnerLogin: from-global', '  projectNumber: 9', ''].join('\n'));
    writeConfig(join(projectRoot, '.config'), ['board:', '  projectOwnerLogin: from-project', '  projectNumber: 1', ''].join('\n'));

    const config = loadGdlcConfig(projectRoot, { XDG_CONFIG_HOME: globalRoot });
    expect(config).toEqual({ board: { projectOwnerLogin: 'from-project', projectNumber: 1 } });
  });

  it('returns an empty config when neither layer has a file', () => {
    // An injected existsFn keeps the upward search hermetic -- a real climb
    // to the filesystem root risks a false match against whatever the
    // test-running machine's real ancestor directories happen to contain.
    const existsFn = () => false;
    expect(loadGdlcConfig(tmpDir(), { XDG_CONFIG_HOME: tmpDir() }, existsFn)).toEqual({});
  });

  it('issue #106: finds the project layer when cwd is nested two directories below the project root', () => {
    const projectRoot = tmpDir();
    writeConfig(join(projectRoot, '.config'), ['destination:', '  repo: "acme/central"', ''].join('\n'));
    const nestedCwd = join(projectRoot, 'plugins', 'some-plugin', 'mcp-server');
    mkdirSync(nestedCwd, { recursive: true });

    const config = loadGdlcConfig(nestedCwd, { XDG_CONFIG_HOME: tmpDir() });
    expect(config).toEqual({ destination: { repo: 'acme/central' } });
  });

  // ADR-0008 / gdlc#227: a nearer ancestor's config.yml that defines only
  // board: (no packs:/prLifecycle: at all) must not shadow those sections
  // set at a FURTHER ancestor -- the merge has to keep climbing past the
  // board-only file instead of stopping there and falling straight through
  // to the global layer. This is this repo's own real topology
  // (repos/gdlc/.config/gdlc/config.yml defines only board:).
  it('merges a further ancestor project layer for sections a nearer ancestor board-only file omits', () => {
    const outerRoot = tmpDir();
    writeConfig(join(outerRoot, '.config'), ['packs:', '  hooks: true', ''].join('\n'));
    const innerRoot = join(outerRoot, 'repos', 'gdlc');
    mkdirSync(innerRoot, { recursive: true });
    writeConfig(join(innerRoot, '.config'), ['board:', '  projectOwnerLogin: acme', '  projectNumber: 1', ''].join('\n'));

    const config = loadGdlcConfig(innerRoot, { XDG_CONFIG_HOME: tmpDir() });
    expect(config).toEqual({
      board: { projectOwnerLogin: 'acme', projectNumber: 1 },
      packs: { hooks: true },
    });
  });

  // ADR-0008: the sharper case -- a nearer ancestor's file DOES have the
  // section's header, but it resolves to zero valid parsed content (a
  // comment-only body, or every key malformed). This must ALSO not shadow
  // a further ancestor's real value. This is the specific trigger an
  // earlier reverted fix attempt got wrong (a header-regex-only presence
  // predicate treated "header present" as "section defined here", which
  // disagreed with normalizeConfig's real presence check).
  it('does not let a nearer ancestor with a present-but-empty packs: header shadow a further ancestor', () => {
    const outerRoot = tmpDir();
    writeConfig(join(outerRoot, '.config'), ['packs:', '  hooks: true', ''].join('\n'));
    const innerRoot = join(outerRoot, 'repos', 'gdlc');
    mkdirSync(innerRoot, { recursive: true });
    // packs: header present, but the only child line is a comment -- zero
    // keys parse, so normalizeConfig omits `packs` from this layer entirely.
    writeConfig(join(innerRoot, '.config'), ['packs:', '  # nothing configured yet', ''].join('\n'));

    const config = loadGdlcConfig(innerRoot, { XDG_CONFIG_HOME: tmpDir() });
    expect(config).toEqual({ packs: { hooks: true } });
  });

  it('a nearer ancestor section still wins over the same section at a further ancestor', () => {
    const outerRoot = tmpDir();
    writeConfig(join(outerRoot, '.config'), ['board:', '  projectOwnerLogin: from-outer', '  projectNumber: 9', ''].join('\n'));
    const innerRoot = join(outerRoot, 'repos', 'gdlc');
    mkdirSync(innerRoot, { recursive: true });
    writeConfig(join(innerRoot, '.config'), ['board:', '  projectOwnerLogin: from-inner', '  projectNumber: 1', ''].join('\n'));

    const config = loadGdlcConfig(innerRoot, { XDG_CONFIG_HOME: tmpDir() });
    expect(config).toEqual({ board: { projectOwnerLogin: 'from-inner', projectNumber: 1 } });
  });

  it('still falls through to global when NO ancestor at all defines a section, board-only files included', () => {
    const outerRoot = tmpDir();
    const globalRoot = join(outerRoot, 'global-config');
    writeConfig(globalRoot, ['packs:', '  hooks: true', ''].join('\n'));
    const innerRoot = join(outerRoot, 'repos', 'gdlc');
    mkdirSync(innerRoot, { recursive: true });
    writeConfig(join(innerRoot, '.config'), ['board:', '  projectOwnerLogin: acme', '  projectNumber: 1', ''].join('\n'));

    const config = loadGdlcConfig(innerRoot, { XDG_CONFIG_HOME: globalRoot });
    expect(config).toEqual({
      board: { projectOwnerLogin: 'acme', projectNumber: 1 },
      packs: { hooks: true },
    });
  });
});

describe('findAllProjectConfigPaths', () => {
  it('returns every ancestor with a config file, nearest first', () => {
    const outerRoot = tmpDir();
    writeConfig(join(outerRoot, '.config'), 'packs:\n  hooks: true\n');
    const innerRoot = join(outerRoot, 'repos', 'gdlc');
    mkdirSync(innerRoot, { recursive: true });
    writeConfig(join(innerRoot, '.config'), 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');

    const paths = findAllProjectConfigPaths(innerRoot, existsSync, { XDG_CONFIG_HOME: tmpDir() });
    expect(paths).toEqual([resolveConfigPath(join(innerRoot, '.config')), resolveConfigPath(join(outerRoot, '.config'))]);
  });

  it("excludes a match that is literally the global layer's own path, but keeps climbing past it", () => {
    // Same collision simulation as resolveProjectConfigPath's own test: the
    // upward search legitimately passes through the global config root for
    // any cwd under it, so the guard has to exclude an exact path match
    // without stopping the climb there.
    const collisionRoot = '/collision-root';
    const globalConfigDir = join(collisionRoot, '.config');
    const furtherAncestorConfigDir = join(dirname(collisionRoot), '.config');
    const existsFn = (p: string) => p === resolveConfigPath(globalConfigDir) || p === resolveConfigPath(furtherAncestorConfigDir);
    const startDir = join(collisionRoot, 'a', 'b');

    const paths = findAllProjectConfigPaths(startDir, existsFn, { XDG_CONFIG_HOME: globalConfigDir });
    expect(paths).toEqual([resolveConfigPath(furtherAncestorConfigDir)]);
  });

  it('returns [] when no ancestor has a config file', () => {
    expect(findAllProjectConfigPaths(tmpDir(), () => false, { XDG_CONFIG_HOME: tmpDir() })).toEqual([]);
  });
});

describe('findProjectConfigRoot', () => {
  it('returns startDir itself when the config file is already there', () => {
    const projectRoot = tmpDir();
    writeConfig(join(projectRoot, '.config'), 'destination:\n  repo: "acme/central"\n');
    expect(findProjectConfigRoot(projectRoot)).toBe(projectRoot);
  });

  it('climbs upward from a nested subdirectory to find an ancestor project root', () => {
    const projectRoot = tmpDir();
    writeConfig(join(projectRoot, '.config'), 'destination:\n  repo: "acme/central"\n');
    const nested = join(projectRoot, 'a', 'b', 'c');
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfigRoot(nested)).toBe(projectRoot);
  });

  it('returns null when no ancestor has the file, via an injected existsFn so the search never touches the real filesystem', () => {
    // A real climb to the filesystem root risks a false match against
    // whatever the test-running machine's real ancestor directories happen
    // to contain; an injected existsFn keeps this hermetic.
    const existsFn = () => false;
    expect(findProjectConfigRoot('/some/deeply/nested/path', existsFn)).toBeNull();
  });

  it('issue #106: does NOT find a project root that is a DESCENDANT of startDir -- the exact reported topology', () => {
    // The bug report's actual scenario: cwd is the workspace root, an
    // ANCESTOR of the real project directory (repos/gdlc), not nested
    // inside it. Upward search climbs away from descendants, never toward
    // them -- this is a deliberate, documented limitation (see ADR-0005),
    // not something this function is expected to solve.
    const workspaceRoot = tmpDir();
    const projectDir = join(workspaceRoot, 'repos', 'gdlc');
    writeConfig(join(projectDir, '.config'), 'destination:\n  repo: "acme/central"\n');
    expect(findProjectConfigRoot(workspaceRoot)).toBeNull();
  });

  it('impartial-review finding: never checks or returns the ceiling directory itself, even when it genuinely has the file', () => {
    // The default ceiling is homedir() -- overridden here to a controlled
    // tmp dir so the test can prove the boundary deterministically without
    // touching the real home directory. A real config file placed exactly
    // AT the ceiling (simulating a stray ~/.config/gdlc/config.yml) must
    // never be found, even though it genuinely exists on disk.
    const ceilingDir = tmpDir();
    writeConfig(join(ceilingDir, '.config'), 'destination:\n  repo: "acme/central"\n');
    const nested = join(ceilingDir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findProjectConfigRoot(nested, existsSync, ceilingDir)).toBeNull();
  });
});

describe('resolveProjectConfigPath', () => {
  it('returns the resolved file path when found', () => {
    const projectRoot = tmpDir();
    writeConfig(join(projectRoot, '.config'), 'destination:\n  repo: "acme/central"\n');
    expect(resolveProjectConfigPath(projectRoot)).toBe(resolveConfigPath(join(projectRoot, '.config')));
  });

  it('returns null when nothing is found', () => {
    const existsFn = () => false;
    expect(resolveProjectConfigPath('/some/deeply/nested/path', existsFn)).toBeNull();
  });

  it('impartial-review finding: does not report the global layer\'s own file as a "project" match', () => {
    // The upward search legitimately passes through the global config
    // root for any cwd under it (virtually always true when the root is
    // the real ~/.config default). Simulated here via a collision between
    // XDG_CONFIG_HOME and a directory the search climbs through, without
    // touching the real filesystem or real homedir().
    const collisionRoot = '/collision-root';
    const globalConfigDir = join(collisionRoot, '.config');
    const existsFn = (p: string) => p === resolveConfigPath(globalConfigDir);
    const startDir = join(collisionRoot, 'a', 'b');

    // Sanity check: the naive upward search alone (no collision guard) DOES
    // find this directory -- proving the guard is what prevents it from
    // being reported as a project-specific path below.
    expect(findProjectConfigRoot(startDir, existsFn)).toBe(collisionRoot);

    expect(resolveProjectConfigPath(startDir, existsFn, { XDG_CONFIG_HOME: globalConfigDir })).toBeNull();
  });
});

describe('resolveBoardCoordinates', () => {
  it('prefers explicit arguments over config', () => {
    const config = { board: { projectOwnerLogin: 'from-config', projectNumber: 9 } };
    expect(resolveBoardCoordinates({ projectOwnerLogin: 'explicit', projectNumber: 1 }, config)).toEqual({
      projectOwnerLogin: 'explicit',
      projectNumber: 1,
    });
  });

  it('falls back to config when explicit args are absent', () => {
    const config = { board: { projectOwnerLogin: 'acme', projectNumber: 3, projectOwnerType: 'user' as const } };
    expect(resolveBoardCoordinates({}, config)).toEqual({ projectOwnerLogin: 'acme', projectNumber: 3, projectOwnerType: 'user' });
  });

  it('returns undefined when projectOwnerLogin is missing after merge', () => {
    expect(resolveBoardCoordinates({ projectNumber: 1 }, {})).toBeUndefined();
  });

  it('returns undefined when projectNumber is missing after merge', () => {
    expect(resolveBoardCoordinates({ projectOwnerLogin: 'acme' }, {})).toBeUndefined();
  });

  it('does not mix an explicit login with a configured number -- projectOwnerLogin/projectNumber are atomic', () => {
    const config = { board: { projectOwnerLogin: 'from-config', projectNumber: 5 } };
    expect(resolveBoardCoordinates({ projectOwnerLogin: 'explicit' }, config)).toBeUndefined();
  });

  it('does not mix a configured login with an explicit number', () => {
    const config = { board: { projectOwnerLogin: 'from-config', projectNumber: 5 } };
    expect(resolveBoardCoordinates({ projectNumber: 99 }, config)).toBeUndefined();
  });

  it('ignores config entirely once both fields are given explicitly', () => {
    const config = { board: { projectOwnerLogin: 'from-config', projectNumber: 5 } };
    expect(resolveBoardCoordinates({ projectOwnerLogin: 'explicit', projectNumber: 1 }, config)).toEqual({
      projectOwnerLogin: 'explicit',
      projectNumber: 1,
    });
  });

  it('still defaults projectOwnerType from config even when login/number are both explicit', () => {
    const config = { board: { projectOwnerLogin: 'from-config', projectNumber: 5, projectOwnerType: 'user' as const } };
    expect(resolveBoardCoordinates({ projectOwnerLogin: 'explicit', projectNumber: 1 }, config)).toEqual({
      projectOwnerLogin: 'explicit',
      projectNumber: 1,
      projectOwnerType: 'user',
    });
  });
});

describe('resolveDestinationRepo', () => {
  it('splits a configured org/repo', () => {
    expect(resolveDestinationRepo({ destination: { repo: 'acme/central' } })).toEqual({ owner: 'acme', repo: 'central' });
  });

  it('returns undefined when unset', () => {
    expect(resolveDestinationRepo({})).toBeUndefined();
  });

  it('returns undefined when malformed (no slash)', () => {
    expect(resolveDestinationRepo({ destination: { repo: 'not-a-repo' } })).toBeUndefined();
  });
});

describe('isRepoAllowed', () => {
  it('allows everything when no targeting section is configured', () => {
    expect(isRepoAllowed({}, 'acme', 'widgets')).toBe(true);
  });

  it('allows everything when the allowlists are present but empty', () => {
    expect(isRepoAllowed({ targeting: { allowRepos: [], allowOrgs: [] } }, 'acme', 'widgets')).toBe(true);
  });

  it('allows a repo present in allowRepos', () => {
    expect(isRepoAllowed({ targeting: { allowRepos: ['acme/widgets'] } }, 'acme', 'widgets')).toBe(true);
  });

  it('allows any repo under an org present in allowOrgs', () => {
    expect(isRepoAllowed({ targeting: { allowOrgs: ['acme'] } }, 'acme', 'anything')).toBe(true);
  });

  it('rejects a repo not present in either allowlist', () => {
    expect(isRepoAllowed({ targeting: { allowRepos: ['acme/widgets'], allowOrgs: ['other-org'] } }, 'acme', 'gadgets')).toBe(false);
  });
});

describe('isPackEnabled', () => {
  it('ADR-0006: is fail-closed when no packs section is configured', () => {
    expect(isPackEnabled({}, 'hooks')).toBe(false);
  });

  it('ADR-0006: is fail-closed when the pack key is absent', () => {
    expect(isPackEnabled({ packs: { hooks: true } }, 'gh-aw')).toBe(false);
  });

  it('ADR-0006: is true only when the pack is explicitly true', () => {
    expect(isPackEnabled({ packs: { hooks: true, 'gh-aw': false } }, 'hooks')).toBe(true);
    expect(isPackEnabled({ packs: { hooks: true, 'gh-aw': false } }, 'gh-aw')).toBe(false);
  });
});

describe('loadConfigFile: prLifecycle section', () => {
  it('reads a well-formed prLifecycle section', () => {
    const root = tmpDir();
    writeConfig(
      root,
      [
        'prLifecycle:',
        '  enabled: true',
        '  localReviewer: "/code-review:code-review --fix"',
        '  requireLocalReview: true',
        '  requireCopilotReview: false',
        '  requireCleanCodeScanning: true',
        '  gateNewWorkOnUnresolvedThreads: false',
        '',
      ].join('\n'),
    );
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({
      prLifecycle: {
        enabled: true,
        localReviewer: '/code-review:code-review --fix',
        requireLocalReview: true,
        requireCopilotReview: false,
        requireCleanCodeScanning: true,
        gateNewWorkOnUnresolvedThreads: false,
      },
    });
  });

  it('drops non-boolean/non-string entries rather than throwing', () => {
    const root = tmpDir();
    writeConfig(root, ['prLifecycle:', '  enabled: "yes"', '  requireLocalReview: true', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ prLifecycle: { requireLocalReview: true } });
  });

  it('drops an empty-string localReviewer, same as a missing one', () => {
    const root = tmpDir();
    writeConfig(root, ['prLifecycle:', '  localReviewer: ""', '  enabled: true', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ prLifecycle: { enabled: true } });
  });

  // Copilot review finding: a quoted whitespace-only localReviewer must
  // fail closed the same way an empty string does, and match the
  // hooks-layer reader's (pr-lifecycle-config.mjs) trimmed behavior.
  it('drops a whitespace-only localReviewer, and trims a value with leading/trailing whitespace', () => {
    const root = tmpDir();
    writeConfig(root, ['prLifecycle:', '  localReviewer: "   "', '  enabled: true', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ prLifecycle: { enabled: true } });

    const root2 = tmpDir();
    writeConfig(root2, ['prLifecycle:', '  localReviewer: "  /my-org:review  "', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root2))).toEqual({ prLifecycle: { localReviewer: '/my-org:review' } });
  });

  it('omits prLifecycle entirely when every entry is malformed', () => {
    const root = tmpDir();
    writeConfig(root, ['prLifecycle:', '  enabled: "yes"', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({});
  });
});

describe('mergeConfigs: prLifecycle section', () => {
  it('takes project prLifecycle wholly over global when both define it', () => {
    const global = { prLifecycle: { enabled: true, requireCopilotReview: false } };
    const project = { prLifecycle: { enabled: false } };
    expect(mergeConfigs(global, project)).toEqual({ prLifecycle: { enabled: false } });
  });
});

describe('resolvePrLifecycleConfig', () => {
  it('is fail-closed (enabled: false) when no prLifecycle section is configured, matching every other opt-in surface', () => {
    expect(resolvePrLifecycleConfig({})).toEqual({
      enabled: false,
      localReviewer: '/code-review:code-review --fix',
      requireLocalReview: true,
      requireCopilotReview: true,
      requireCleanCodeScanning: true,
      gateNewWorkOnUnresolvedThreads: true,
    });
  });

  it('is fail-closed when enabled is present but not literally true', () => {
    expect(resolvePrLifecycleConfig({ prLifecycle: {} }).enabled).toBe(false);
  });

  it('defaults every require* toggle and localReviewer to the strictest behavior once enabled', () => {
    expect(resolvePrLifecycleConfig({ prLifecycle: { enabled: true } })).toEqual({
      enabled: true,
      localReviewer: '/code-review:code-review --fix',
      requireLocalReview: true,
      requireCopilotReview: true,
      requireCleanCodeScanning: true,
      gateNewWorkOnUnresolvedThreads: true,
    });
  });

  it('respects explicit overrides for every field', () => {
    expect(
      resolvePrLifecycleConfig({
        prLifecycle: {
          enabled: true,
          localReviewer: '/my-org:review',
          requireLocalReview: false,
          requireCopilotReview: false,
          requireCleanCodeScanning: false,
          gateNewWorkOnUnresolvedThreads: false,
        },
      }),
    ).toEqual({
      enabled: true,
      localReviewer: '/my-org:review',
      requireLocalReview: false,
      requireCopilotReview: false,
      requireCleanCodeScanning: false,
      gateNewWorkOnUnresolvedThreads: false,
    });
  });
});
