import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveConfigPath,
  resolveGlobalConfigRoot,
  loadConfigFile,
  mergeConfigs,
  loadGdlcConfig,
  resolveBoardCoordinates,
  resolveDestinationRepo,
  isRepoAllowed,
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
        '',
      ].join('\n'),
    );
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({
      targeting: { allowRepos: ['acme/widgets'], allowOrgs: ['acme'] },
      destination: { repo: 'acme/central' },
      board: { projectOwnerLogin: 'acme', projectNumber: 3, projectOwnerType: 'organization' },
    });
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

  it('drops non-scalar entries (objects/arrays/null) from allowlist arrays', () => {
    const root = tmpDir();
    writeConfig(root, ['targeting:', '  allowRepos: ["acme/widgets", null, {a: 1}]', ''].join('\n'));
    expect(loadConfigFile(resolveConfigPath(root))).toEqual({ targeting: { allowRepos: ['acme/widgets'] } });
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
    expect(loadGdlcConfig(tmpDir(), { XDG_CONFIG_HOME: tmpDir() })).toEqual({});
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
