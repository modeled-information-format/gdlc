import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// gdlc#326: mergeStage's JS guard used to short-circuit on
// `dev.settle.settled !== true` alone, before the merge agent (and #306's
// --admin-retry authorization) was ever invoked. That made the retry path
// structurally unreachable for the one case it exists to handle: settled is
// correctly false (per #305) when the ONLY blocker is a missing approval.
// These tests load and execute the REAL, currently-shipped workflow file
// body (same technique as query-pipeline-workflow-guard.test.ts) so a
// regression in the guard's logic fails here without needing a hand-copied
// reimplementation that could silently drift from what's actually shipped.
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

function makeAgent(overrides: {
  discover?: unknown;
  develop?: unknown;
  review?: unknown;
  settle?: unknown;
  merge?: unknown;
}) {
  const calls: AgentCall[] = [];
  const agent: AgentFn = vi.fn(async (_prompt, opts) => {
    calls.push({ label: opts.label, phase: opts.phase });
    if (opts.label === 'discover') return overrides.discover;
    if (opts.label.startsWith('develop:')) return overrides.develop;
    if (opts.label.startsWith('review:')) return overrides.review ?? { ok: true, findingsFixed: 0, notes: 'no findings' };
    if (opts.label.startsWith('settle:')) return overrides.settle;
    if (opts.label.startsWith('merge:')) return overrides.merge ?? { merged: true, notes: 'merged' };
    throw new Error(`unexpected agent() call in test: ${opts.label}`);
  });
  return { agent, calls };
}

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

const PR_ITEM = {
  repo: 'acme/widgets',
  number: 42,
  kind: 'pr',
  title: 'An existing PR',
  url: 'https://github.com/acme/widgets/pull/42',
};

describe('query-pipeline.workflow.js — mergeStage settled-gate reachability (gdlc#326)', () => {
  it('invokes the merge agent when settled is false but blockedOnApprovalOnly is true (the #306 --admin-retry case)', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [PR_ITEM] },
      settle: {
        settled: false,
        copilotReviewed: true,
        threadsResolved: true,
        blockedOnApprovalOnly: true,
        notes: 'checks green, threads resolved, blocked only on missing approval (REVIEW_REQUIRED)',
      },
      merge: { merged: true, notes: 'merged via --admin retry' },
    });
    const { run } = runWorkflow({ query: 'is:pr is:open', automerge: true }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('merge:'))).toBe(true);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.merged).toBe(true);
  });

  it('still skips the merge agent when settled is false and blockedOnApprovalOnly is false (a real blocker remains)', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [PR_ITEM] },
      settle: {
        settled: false,
        copilotReviewed: true,
        threadsResolved: false,
        blockedOnApprovalOnly: false,
        notes: 'an unresolved review thread remains',
      },
    });
    const { run } = runWorkflow({ query: 'is:pr is:open', automerge: true }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('merge:'))).toBe(false);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.merged).toBe(false);
    expect(processed.notes).toContain('not settled — automerge skipped');
  });

  it('invokes the merge agent when settled is true, unaffected by the new blockedOnApprovalOnly field', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [PR_ITEM] },
      settle: {
        settled: true,
        copilotReviewed: true,
        threadsResolved: true,
        blockedOnApprovalOnly: false,
        notes: 'fully settled',
      },
      merge: { merged: true, notes: 'merged' },
    });
    const { run } = runWorkflow({ query: 'is:pr is:open', automerge: true }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('merge:'))).toBe(true);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.merged).toBe(true);
  });

  it('never invokes the merge agent when automerge is off, regardless of blockedOnApprovalOnly', async () => {
    const { agent, calls } = makeAgent({
      discover: { items: [PR_ITEM] },
      settle: {
        settled: false,
        copilotReviewed: true,
        threadsResolved: true,
        blockedOnApprovalOnly: true,
        notes: 'blocked only on missing approval',
      },
    });
    const { run } = runWorkflow({ query: 'is:pr is:open', automerge: false }, agent);
    const result = await run;

    expect(calls.some((c) => c.label.startsWith('merge:'))).toBe(false);

    const processed = (result.processed as Array<Record<string, unknown>>)[0];
    expect(processed.merged).toBe(false);
    expect(processed.notes).toContain('automerge off');
  });
});
