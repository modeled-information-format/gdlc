import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// gdlc#307: query-pipeline's Discover phase used to hand every discovered
// issue straight to the Develop agent with no check for whether a PRIOR
// run already started it (board Status In Progress, no PR yet) -- harmless
// for a one-shot run, but a real duplicate-work/duplicate-PR bug the moment
// the same query is swept on a recurring schedule.
//
// The workflow script (`query-pipeline.workflow.js`) is executed by the
// Claude Code Workflow tool as an async function body with `args`/`agent`/
// `pipeline`/`phase`/`log` injected as bindings, NOT as a plain ES module --
// it uses bare top-level `return` statements, which are a hard syntax error
// in a real module (confirmed: `node --input-type=module` on this exact
// file throws "Illegal return statement"). This loader reproduces that same
// wrapping so these tests execute the REAL, currently-shipped file content
// end to end against fake `agent`/`pipeline` implementations, rather than a
// hand-copied reimplementation of its guard logic that could silently drift
// from what the workflow actually ships.
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(
  thisDir,
  '../../../skills/query-pipeline/scripts/query-pipeline.workflow.js',
);

function loadWorkflowBody(): string {
  const source = readFileSync(workflowPath, 'utf8');
  const metaStart = source.indexOf('export const meta');
  if (metaStart === -1) throw new Error('expected an `export const meta = {...}` header in query-pipeline.workflow.js');
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

/** A fake `agent()` dispatching on the `label` every real call site in the
 * workflow script passes -- `discover`, `guard:<repo>#<n>`, `develop:<repo>#<n>`,
 * `review:<repo>#<n>`, `settle:<repo>#<n>`. Unregistered review/settle calls
 * fall back to a benign "nothing to do" response so tests that only care
 * about the Develop-stage guard don't have to hand-supply every downstream
 * stage's response. */
function makeAgent(overrides: {
  discover?: unknown;
  guard?: unknown;
  develop?: unknown;
  review?: unknown;
  settle?: unknown;
}) {
  const calls: AgentCall[] = [];
  const agent: AgentFn = vi.fn(async (_prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase });
    if (opts.label === 'discover') return overrides.discover;
    if (opts.label.startsWith('guard:')) return overrides.guard;
    if (opts.label.startsWith('develop:')) return overrides.develop;
    if (opts.label.startsWith('review:')) return overrides.review ?? { ok: true, findingsFixed: 0, notes: 'no findings' };
    if (opts.label.startsWith('settle:')) {
      return overrides.settle ?? { settled: true, copilotReviewed: true, threadsResolved: true, notes: 'settled' };
    }
    throw new Error(`unexpected agent() call in test: ${opts.label}`);
  });
  return { agent, calls };
}

/** A fake `pipeline()` matching the doc comment in the real script ("Stage
 * callbacks receive (prevResult, originalItem, index)"): threads each
 * stage's return value into the next, seeded with the item itself for the
 * first stage -- exactly what lets `developStage(item)` (a single-parameter
 * function) work correctly as the first stage in the real pipeline. */
async function fakePipeline(items: unknown[], ...stages: Array<(prev: unknown, item: unknown, index: number) => unknown>) {
  return Promise.all(
    items.map(async (item, index) => {
      let result: unknown = item;
      for (const stage of stages) {
        result = await stage(result, item, index);
      }
      return result;
    }),
  );
}

function runWorkflow(args: unknown, agent: AgentFn) {
  const logLines: string[] = [];
  const log = (msg: string) => {
    logLines.push(msg);
  };
  const phase = () => {};
  const fn = new AsyncFunction('args', 'agent', 'pipeline', 'phase', 'log', loadWorkflowBody());
  return { run: fn(args, agent, fakePipeline, phase, log) as Promise<Record<string, unknown>>, logLines };
}

const ISSUE_ITEM = {
  repo: 'acme/widgets',
  number: 42,
  kind: 'issue',
  title: 'Do the thing',
  url: 'https://github.com/acme/widgets/issues/42',
};

describe('query-pipeline.workflow.js — per-item re-dispatch guard (gdlc#307)', () => {
  it('skips the Develop agent when the issue is already past "not started" on the board with no PR yet', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [ISSUE_ITEM] },
      guard: { alreadyInProgress: true, status: 'In Progress', notes: 'matched In Progress' },
    });
    const { run, logLines } = runWorkflow({ query: 'is:issue is:open label:tech-debt' }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('guard:'))).toBe(true);
    expect(calls.some((c) => c.label.startsWith('develop:'))).toBe(false);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.ok).toBe(true);
    expect(processed.prUrl).toBeNull();
    expect(processed.notes).toContain('already');
    expect(processed.notes).toContain('gdlc#307');
    expect(logLines.some((l) => l.includes('re-dispatch guard'))).toBe(true);
  });

  it('still proceeds to full development when the guard reports nothing is in flight', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [ISSUE_ITEM] },
      guard: { alreadyInProgress: false, status: 'Todo' },
      develop: {
        ok: true,
        prNumber: 99,
        prUrl: 'https://github.com/acme/widgets/pull/99',
        branch: 'fix/42-do-the-thing',
        notes: 'opened PR',
      },
    });
    const { run } = runWorkflow({ query: 'is:issue is:open label:tech-debt' }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('guard:'))).toBe(true);
    expect(calls.some((c) => c.label.startsWith('develop:'))).toBe(true);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.prUrl).toBe('https://github.com/acme/widgets/pull/99');
  });

  it('never invokes the guard for an item that is already a PR (existing shortcut is unaffected)', async () => {
    const prItem = {
      repo: 'acme/widgets',
      number: 7,
      kind: 'pr',
      title: 'An existing PR',
      url: 'https://github.com/acme/widgets/pull/7',
    };
    const { agent, calls } = makeAgent({ discover: { items: [prItem] } });
    const { run } = runWorkflow({ query: 'is:pr is:open' }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('guard:'))).toBe(false);
    expect(calls.some((c) => c.label.startsWith('develop:'))).toBe(false);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.prUrl).toBe(prItem.url);
  });
});
