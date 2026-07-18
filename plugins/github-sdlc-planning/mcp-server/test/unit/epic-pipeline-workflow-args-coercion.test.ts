import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// gdlc#321: the Workflow tool can deliver `args` as a JSON-encoded string
// rather than an object (harness-dependent) -- the mode guard used to read
// `args.mode` directly and hard-fail 4ms in, zero agents run, whenever that
// happened. The fix coerces a string `args` via JSON.parse before the guard.
//
// Loaded and executed the same way as the sibling
// query-pipeline-workflow-guard.test.ts: the workflow script is run by the
// Claude Code Workflow tool as an async function body with `args`/`agent`/
// `pipeline`/`phase`/`log` injected as bindings, NOT as a plain ES module --
// it uses bare top-level `return` statements, a hard syntax error in a real
// module. This loader reproduces that wrapping so these tests exercise the
// REAL, currently-shipped file content end to end, not a hand-copied
// reimplementation of its guard logic that could silently drift.
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  thisDir,
  '../../../skills/epic-pipeline/scripts/epic-pipeline.workflow.js',
);

function loadWorkflowBody(): string {
  const source = readFileSync(workflowPath, 'utf8');
  const metaStart = source.indexOf('export const meta');
  if (metaStart === -1) throw new Error('expected an `export const meta = {...}` header in epic-pipeline.workflow.js');
  const braceStart = source.indexOf('{', metaStart);
  let depth = 0;
  let i = braceStart;
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error('could not find the end of the `meta` object literal');
  return source.slice(i + 1);
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...callArgs: unknown[]) => Promise<unknown>;

type AgentCall = { label: string; phase: string };
type AgentFn = (prompt: string, opts: AgentCall) => Promise<unknown>;

/** A fake `agent()` dispatching on the `label` every real plan-mode call
 * site in the workflow script passes -- `ground`, `decompose`. */
function makeAgent(overrides: { ground?: unknown; decompose?: unknown }) {
  const calls: AgentCall[] = [];
  const agent: AgentFn = vi.fn(async (_prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase });
    if (opts.label === 'ground') return overrides.ground;
    if (opts.label === 'decompose') return overrides.decompose;
    throw new Error(`unexpected agent() call in test: ${opts.label}`);
  });
  return { agent, calls };
}

function runWorkflow(args: unknown, agent: AgentFn) {
  const logLines: string[] = [];
  const log = (msg: string) => {
    logLines.push(msg);
  };
  const phase = () => {};
  const pipeline = async () => {
    throw new Error('pipeline() is not used by plan mode and should not be called in these tests');
  };
  const fn = new AsyncFunction('args', 'agent', 'pipeline', 'phase', 'log', loadWorkflowBody());
  return { run: fn(args, agent, pipeline, phase, log) as Promise<Record<string, unknown>>, logLines };
}

const GROUNDING = {
  summary: 'nothing exists yet for this seed',
  existingCoverage: [],
  requiredChecks: ['ci / build'],
  protectionNotes: 'enforceAdmins true, 1 required review',
};

const DECOMPOSED = {
  ok: true,
  epic: { number: 900, url: 'https://github.com/acme/widgets/issues/900', title: 'Epic', preexisting: false },
  children: [{ number: 901, title: 'Task one', kind: 'Task', parent: null, status: 'Todo' }],
  buildOrder: [901],
  milestone: { assigned: false, number: null, reason: 'no milestone fits yet' },
  deferred: [],
  notes: 'planned',
};

describe('epic-pipeline.workflow.js — args coercion before the mode guard (gdlc#321)', () => {
  it('runs plan mode normally when args arrives as a real object (baseline, unaffected by the fix)', async () => {
    const { agent } = makeAgent({ ground: GROUNDING, decompose: DECOMPOSED });
    const { run } = runWorkflow({ mode: 'plan', owner: 'acme', repo: 'widgets', seed: '#1' }, agent);
    const result = await run;

    expect(result.ok).toBe(true);
    expect((result.hierarchy as Record<string, unknown>).epic).toEqual(DECOMPOSED.epic);
  });

  it('coerces a JSON-string args before the mode guard and still runs plan mode to completion', async () => {
    const { agent } = makeAgent({ ground: GROUNDING, decompose: DECOMPOSED });
    const stringArgs = JSON.stringify({ mode: 'plan', owner: 'acme', repo: 'widgets', seed: '#1' });
    const { run } = runWorkflow(stringArgs, agent);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('plan');
    expect((result.hierarchy as Record<string, unknown>).epic).toEqual(DECOMPOSED.epic);
  });

  it('throws a clear error (not a raw JSON.parse error) when a string args is not valid JSON', async () => {
    const { agent } = makeAgent({});
    const { run } = runWorkflow('{mode: plan, not valid json', agent);

    await expect(run).rejects.toThrow(/epic-pipeline received args as an unparsed string and it is not valid JSON/);
  });

  it('still rejects a real object missing mode exactly as before (guard behavior unaffected by the fix)', async () => {
    const { agent } = makeAgent({});
    const { run } = runWorkflow({ owner: 'acme', repo: 'widgets', seed: '#1' }, agent);

    await expect(run).rejects.toThrow(/epic-pipeline requires args.mode of 'plan' or 'execute'/);
  });
});
