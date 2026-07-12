import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getGdlcConfig, writeGdlcConfig, GDLC_CONFIG_SECTION_SCHEMAS } from '../../src/tools/config.js';
import { isPlanningError } from '../../src/errors.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'gdlc-config-tools-'));
}

function writeConfig(root: string, contents: string): void {
  const dir = join(root, 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
}

describe('GDLC_CONFIG_SECTION_SCHEMAS', () => {
  it('mirrors gdlc-config.schema.json\'s per-section shape', () => {
    expect(GDLC_CONFIG_SECTION_SCHEMAS.board.safeParse({ projectOwnerLogin: 'acme', projectNumber: 1 }).success).toBe(true);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.board.safeParse({ projectOwnerLogin: 'acme', projectNumber: 0 }).success).toBe(false);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.board.safeParse({ projectOwnerLogin: 'acme' }).success).toBe(false);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.destination.safeParse({ repo: 'acme/widgets' }).success).toBe(true);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.destination.safeParse({ repo: 'not-a-repo' }).success).toBe(false);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.targeting.safeParse({ allowRepos: ['acme/widgets'], allowOrgs: ['acme'] }).success).toBe(true);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.packs.safeParse({ hooks: true, gh_aw: false }).success).toBe(true);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.packs.safeParse({ hooks: 'yes' }).success).toBe(false);
    expect(GDLC_CONFIG_SECTION_SCHEMAS.prLifecycle.safeParse({ enabled: true, requireCopilotReview: false }).success).toBe(true);
  });
});

describe('getGdlcConfig', () => {
  it('falls back to real fs.existsSync and process.env when no deps are passed', () => {
    const startDir = tmpDir();
    const result = getGdlcConfig({ startDir });
    expect(result.layers.some((l) => l.layer === 'global')).toBe(true);
    expect(result.layers.filter((l) => l.layer === 'project')).toEqual([]);
  });

  it('reports the global layer as not-existing with no sections when absent', () => {
    const startDir = tmpDir();
    const env = { XDG_CONFIG_HOME: join(tmpDir(), 'xdg') };
    const result = getGdlcConfig({ startDir }, { env });
    expect(result.resolved).toEqual({});
    expect(result.layers).toEqual([{ layer: 'global', path: expect.stringContaining('config.yml'), exists: false, sections: [] }]);
  });

  it('attributes each section to the layer that actually defines it', () => {
    const xdgRoot = tmpDir();
    writeConfig(xdgRoot, 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');
    const projectRoot = tmpDir();
    writeConfig(join(projectRoot, '.config'), 'packs:\n  hooks: true\n');
    const env = { XDG_CONFIG_HOME: xdgRoot };

    const result = getGdlcConfig({ startDir: projectRoot }, { env });

    expect(result.resolved).toEqual({
      board: { projectOwnerLogin: 'acme', projectNumber: 1 },
      packs: { hooks: true },
    });
    expect(result.layers).toEqual([
      { layer: 'global', path: join(xdgRoot, 'gdlc', 'config.yml'), exists: true, sections: ['board'] },
      { layer: 'project', path: join(projectRoot, '.config', 'gdlc', 'config.yml'), exists: true, sections: ['packs'] },
    ]);
  });

  it('lists every ancestor project layer that defines the file, nearest first', () => {
    const grandparent = tmpDir();
    writeConfig(join(grandparent, '.config'), 'packs:\n  hooks: true\n');
    const child = join(grandparent, 'nested');
    mkdirSync(child, { recursive: true });
    writeConfig(join(child, '.config'), 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');
    const env = { XDG_CONFIG_HOME: join(tmpDir(), 'xdg') };

    const result = getGdlcConfig({ startDir: child }, { env });

    const projectLayers = result.layers.filter((l) => l.layer === 'project');
    expect(projectLayers).toEqual([
      { layer: 'project', path: join(child, '.config', 'gdlc', 'config.yml'), exists: true, sections: ['board'] },
      { layer: 'project', path: join(grandparent, '.config', 'gdlc', 'config.yml'), exists: true, sections: ['packs'] },
    ]);
  });
});

describe('writeGdlcConfig', () => {
  it('rejects an unknown top-level section', () => {
    expect(() =>
      writeGdlcConfig(
        { layer: 'project', root: '/some/root', sections: { notASection: { foo: 'bar' } } as never },
        { existsFn: () => false },
      ),
    ).toThrowError();
    try {
      writeGdlcConfig(
        { layer: 'project', root: '/some/root', sections: { notASection: { foo: 'bar' } } as never },
        { existsFn: () => false },
      );
    } catch (err) {
      expect(isPlanningError(err)).toBe(true);
      if (isPlanningError(err)) expect(err.code).toBe('invalid_config');
    }
  });

  it('rejects a section that fails its own schema', () => {
    expect(() =>
      writeGdlcConfig(
        { layer: 'project', root: '/some/root', sections: { board: { projectOwnerLogin: 'acme' } } },
        { existsFn: () => false },
      ),
    ).toThrowError();
  });

  it('dryRun returns content without writing to disk', () => {
    const writeFileFn = vi.fn();
    const mkdirFn = vi.fn();
    const result = writeGdlcConfig(
      { layer: 'project', root: '/some/root', sections: { board: { projectOwnerLogin: 'acme', projectNumber: 1 } }, dryRun: true },
      { existsFn: () => false, writeFileFn, mkdirFn },
    );
    expect(result.dryRun).toBe(true);
    expect(result.written).toBe(false);
    expect(result.content).toContain('projectOwnerLogin: acme');
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  it('writes a brand-new file for a fresh project layer', () => {
    const writeFileFn = vi.fn();
    const mkdirFn = vi.fn();
    const result = writeGdlcConfig(
      { layer: 'project', root: '/some/root', sections: { board: { projectOwnerLogin: 'acme', projectNumber: 1 } } },
      { existsFn: () => false, writeFileFn, mkdirFn },
    );
    expect(result.written).toBe(true);
    expect(result.path).toBe(join('/some/root', '.config', 'gdlc', 'config.yml'));
    expect(writeFileFn).toHaveBeenCalledWith(result.path, result.content);
    expect(mkdirFn).toHaveBeenCalled();
  });

  it('resolves the global layer path under XDG_CONFIG_HOME, not process.cwd()', () => {
    const writeFileFn = vi.fn();
    const result = writeGdlcConfig(
      { layer: 'global', sections: { packs: { hooks: true } } },
      { existsFn: () => false, writeFileFn, mkdirFn: vi.fn(), env: { XDG_CONFIG_HOME: '/xdg/root' } },
    );
    expect(result.path).toBe(join('/xdg/root', 'gdlc', 'config.yml'));
  });

  it('defaults project root to process.cwd() when root is omitted', () => {
    const writeFileFn = vi.fn();
    const result = writeGdlcConfig(
      { layer: 'project', sections: { packs: { hooks: true } } },
      { existsFn: () => false, writeFileFn, mkdirFn: vi.fn() },
    );
    expect(result.path).toBe(join(process.cwd(), '.config', 'gdlc', 'config.yml'));
  });

  it('preserves an untouched section\'s formatting/comments byte-for-byte (CST-preserving write)', () => {
    const existing = [
      '# targeting policy: only these repos capture issues',
      'targeting:',
      '  allowRepos: ["acme/widgets"] # keep in sync with README',
      '',
      'board:',
      '  projectOwnerLogin: acme',
      '  projectNumber: 1',
      '',
    ].join('\n');
    const writeFileFn = vi.fn();
    const result = writeGdlcConfig(
      { layer: 'project', root: '/some/root', sections: { board: { projectOwnerLogin: 'acme', projectNumber: 2 } } },
      { existsFn: () => true, readFileFn: () => existing, writeFileFn, mkdirFn: vi.fn() },
    );
    expect(result.content).toContain('# targeting policy: only these repos capture issues');
    expect(result.content).toContain('allowRepos: ["acme/widgets"] # keep in sync with README');
    expect(result.content).toContain('projectNumber: 2');
    expect(result.content).not.toContain('projectNumber: 1');
  });

  it('falls back to real fs calls and writes an actual file when no deps are passed', () => {
    const root = tmpDir();
    const result = writeGdlcConfig({ layer: 'project', root, sections: { packs: { hooks: true } } });
    expect(result.written).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    expect(readFileSync(result.path, 'utf8')).toContain('hooks: true');
  });

  it('adds a new section to an existing file without disturbing the rest', () => {
    const existing = 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n';
    const result = writeGdlcConfig(
      { layer: 'project', root: '/some/root', sections: { packs: { hooks: true } } },
      { existsFn: () => true, readFileFn: () => existing, writeFileFn: vi.fn(), mkdirFn: vi.fn() },
    );
    expect(result.content).toContain('projectOwnerLogin: acme');
    expect(result.content).toContain('hooks: true');
  });
});
