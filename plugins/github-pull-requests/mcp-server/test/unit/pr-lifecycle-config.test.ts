import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The control-plane reader is a dependency-free hooks utility; it is tested
// here so the plugin's single vitest rig covers it, but it is intentionally
// outside src/ (and outside the coverage include) because hooks run it with
// bare node, not through the bundled server. Mirrors github-sdlc-planning's
// hooks-layer test conventions (pack-toggles.test.ts, config.test.ts).
import {
  parsePrLifecycleSection,
  readPrLifecycleRaw,
  resolvePrLifecycle,
} from '../../../hooks/lib/pr-lifecycle-config.mjs';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'pr-lifecycle-config-'));
}

function writeProjectConfig(root: string, contents: string): string {
  const dir = join(root, '.config', 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
  return root;
}

function writeGlobalConfig(globalRoot: string, contents: string): void {
  const dir = join(globalRoot, 'gdlc');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.yml'), contents);
}

function fakeEnv(globalRoot: string): NodeJS.ProcessEnv {
  return { XDG_CONFIG_HOME: globalRoot };
}

const ENABLED = 'prLifecycle:\n  enabled: true\n  requireCopilotReview: false\n';

describe('parsePrLifecycleSection', () => {
  it('reads a well-formed section', () => {
    expect(parsePrLifecycleSection(ENABLED)).toEqual({ found: true, raw: { enabled: true, requireCopilotReview: false } });
  });

  it('reports found: false when there is no prLifecycle: key at all', () => {
    expect(parsePrLifecycleSection('board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n')).toEqual({ found: false, raw: {} });
  });

  it('drops a non-boolean enabled/require* value and a blank localReviewer (fail closed)', () => {
    const text = 'prLifecycle:\n  enabled: "yes"\n  requireLocalReview: true\n  localReviewer: ""\n';
    expect(parsePrLifecycleSection(text)).toEqual({ found: true, raw: { requireLocalReview: true } });
  });

  it('keeps localReviewer as a raw string', () => {
    expect(parsePrLifecycleSection('prLifecycle:\n  localReviewer: "/my-org:review"\n')).toEqual({
      found: true,
      raw: { localReviewer: '/my-org:review' },
    });
  });
});

describe('readPrLifecycleRaw: fallthrough when a present section has zero parseable keys', () => {
  // Regression test for a review-caught bug: `resolveLayerPrLifecycle` used
  // to treat the project layer as "present" merely because the
  // `prLifecycle:` header line existed, even when every child key failed to
  // parse -- short-circuiting the cascade with an EMPTY config instead of
  // falling through to the global layer, silently disagreeing with
  // config.ts's `normalizeConfig`, which omits a fully-malformed section
  // from that layer entirely.
  it('falls through to the global layer when the project section is present but every key is malformed', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, ENABLED);
    writeProjectConfig(dir, 'prLifecycle:\n  enabled: "yes"\n');
    expect(readPrLifecycleRaw(dir, fakeEnv(globalRoot))).toEqual({ enabled: true, requireCopilotReview: false });
  });

  it('still replaces the global layer wholly when the project section has at least one valid key', () => {
    const dir = tmpDir();
    const globalRoot = join(dir, 'global-config');
    writeGlobalConfig(globalRoot, ENABLED);
    writeProjectConfig(dir, 'prLifecycle:\n  enabled: false\n');
    expect(readPrLifecycleRaw(dir, fakeEnv(globalRoot))).toEqual({ enabled: false });
  });

  it('is empty when neither layer has a file', () => {
    const dir = tmpDir();
    expect(readPrLifecycleRaw(dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toEqual({});
  });
});

describe('readPrLifecycleRaw: ADR-0008 N-ancestor resolution', () => {
  // gdlc#227: a nearer ancestor's config.yml that defines only board: (no
  // prLifecycle: section at all) must not shadow a prLifecycle: section
  // set at a FURTHER ancestor -- the search has to keep climbing past the
  // board-only file instead of stopping there and falling straight through
  // to the global layer.
  it('does not let a nearer ancestor config with only board: shadow prLifecycle: set at a further ancestor', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, 'prLifecycle:\n  enabled: false\n');
    writeProjectConfig(outer, ENABLED);
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');

    expect(readPrLifecycleRaw(inner, fakeEnv(globalRoot))).toEqual({ enabled: true, requireCopilotReview: false });
  });

  // The sharper case: a nearer ancestor's file HAS the prLifecycle: header,
  // but it resolves to zero valid parsed content (comment-only body, or
  // every key malformed) -- this must ALSO not shadow a further ancestor's
  // real value. This is the trigger the original fallthrough regression
  // test above already covers for a SINGLE project layer vs global; this
  // extends it to a THIRD layer in between.
  it('does not let a nearer ancestor with a present-but-empty prLifecycle: header shadow a further ancestor', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, 'prLifecycle:\n  enabled: false\n');
    writeProjectConfig(outer, ENABLED);
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'prLifecycle:\n  enabled: "yes"\n');

    expect(readPrLifecycleRaw(inner, fakeEnv(globalRoot))).toEqual({ enabled: true, requireCopilotReview: false });
  });

  it('a nearer ancestor section still wins over the same section at a further ancestor', () => {
    const outer = tmpDir();
    writeProjectConfig(outer, 'prLifecycle:\n  enabled: false\n');
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, ENABLED);

    expect(readPrLifecycleRaw(inner, fakeEnv(join(outer, 'no-such-global')))).toEqual({
      enabled: true,
      requireCopilotReview: false,
    });
  });

  it('still falls through to global when NO ancestor at all defines prLifecycle:, board-only files included', () => {
    const outer = tmpDir();
    const globalRoot = join(outer, 'global-config');
    writeGlobalConfig(globalRoot, ENABLED);
    const inner = join(outer, 'repos', 'gdlc');
    mkdirSync(inner, { recursive: true });
    writeProjectConfig(inner, 'board:\n  projectOwnerLogin: acme\n  projectNumber: 1\n');

    expect(readPrLifecycleRaw(inner, fakeEnv(globalRoot))).toEqual({ enabled: true, requireCopilotReview: false });
  });
});

describe('resolvePrLifecycle: defaults match config.ts resolvePrLifecycleConfig exactly', () => {
  it('is fail-closed (enabled: false) with the documented defaults when unconfigured', () => {
    const dir = tmpDir();
    expect(resolvePrLifecycle(dir, fakeEnv(join(dir, 'no-such-global')), () => false)).toEqual({
      enabled: false,
      localReviewer: '/code-review --fix',
      requireLocalReview: true,
      requireCopilotReview: true,
      requireCleanCodeScanning: true,
      gateNewWorkOnUnresolvedThreads: true,
      confirmLocalReview: false,
      confirmNewWorkGate: false,
    });
  });

  it('defaults every require* toggle and localReviewer to the strictest behavior once enabled, but confirmLocalReview/confirmNewWorkGate stay false', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, 'prLifecycle:\n  enabled: true\n');
    expect(resolvePrLifecycle(dir, fakeEnv(join(dir, 'no-such-global')))).toEqual({
      enabled: true,
      localReviewer: '/code-review --fix',
      requireLocalReview: true,
      requireCopilotReview: true,
      requireCleanCodeScanning: true,
      gateNewWorkOnUnresolvedThreads: true,
      confirmLocalReview: false,
      confirmNewWorkGate: false,
    });
  });

  it('respects explicit overrides for every field', () => {
    const dir = tmpDir();
    writeProjectConfig(
      dir,
      [
        'prLifecycle:',
        '  enabled: true',
        '  localReviewer: "/my-org:review"',
        '  requireLocalReview: false',
        '  requireCopilotReview: false',
        '  requireCleanCodeScanning: false',
        '  gateNewWorkOnUnresolvedThreads: false',
        '  confirmLocalReview: true',
        '  confirmNewWorkGate: true',
        '',
      ].join('\n'),
    );
    expect(resolvePrLifecycle(dir, fakeEnv(join(dir, 'no-such-global')))).toEqual({
      enabled: true,
      localReviewer: '/my-org:review',
      requireLocalReview: false,
      requireCopilotReview: false,
      requireCleanCodeScanning: false,
      gateNewWorkOnUnresolvedThreads: false,
      confirmLocalReview: true,
      confirmNewWorkGate: true,
    });
  });

  // gdlc#275: confirmLocalReview/confirmNewWorkGate default to false,
  // unlike every other require*/gate* toggle here (which default true once
  // enabled) -- this is the opt-IN-to-blocking shape, the inverse of the
  // rest of this section.
  it('defaults confirmLocalReview and confirmNewWorkGate to false even once enabled', () => {
    const dir = tmpDir();
    writeProjectConfig(dir, 'prLifecycle:\n  enabled: true\n');
    const resolved = resolvePrLifecycle(dir, fakeEnv(join(dir, 'no-such-global')));
    expect(resolved.confirmLocalReview).toBe(false);
    expect(resolved.confirmNewWorkGate).toBe(false);
  });
});
