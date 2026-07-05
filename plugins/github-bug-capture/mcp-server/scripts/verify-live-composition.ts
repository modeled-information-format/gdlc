#!/usr/bin/env tsx
/**
 * Composition verification (issue #48): proves the ADR-0002 boundary against
 * the REAL sibling servers, not mocks. Each server's committed dist bundle is
 * spawned as an MCP stdio subprocess, exactly as an MCP host runs it.
 *
 * Two phases:
 *
 * 1. Contract phase (no token needed): every server in the composition
 *    chain — github-bug-capture, github-pull-requests,
 *    github-sdlc-planning — starts, answers `initialize`, and advertises
 *    the tools the boundary depends on. The bug plugin must NOT advertise
 *    tools its siblings own.
 * 2. Live phase (needs GITHUB_TOKEN; sandbox via TARGET_OWNER/TARGET_REPO):
 *    drives the planning side of the contract for real — create an issue,
 *    then attach it to a milestone — the "planning plugin decides where a
 *    bug lands" leg. The capture leg (file_bug) joins this script with the
 *    Layer 1 core (epic #28) and lifecycle tools (epic #33).
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGINS_ROOT = join(HERE, '..', '..', '..');
const SERVERS = {
  'github-bug-capture': join(PLUGINS_ROOT, 'github-bug-capture', 'mcp-server', 'dist', 'index.js'),
  'github-pull-requests': join(PLUGINS_ROOT, 'github-pull-requests', 'mcp-server', 'dist', 'index.js'),
  'github-sdlc-planning': join(PLUGINS_ROOT, 'github-sdlc-planning', 'mcp-server', 'dist', 'index.js'),
} as const;

type ServerName = keyof typeof SERVERS;

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

class McpClient {
  private child: ChildProcessByStdio<Writable, Readable, null>;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;

  constructor(bundlePath: string) {
    this.child = spawn('node', [bundlePath], { stdio: ['pipe', 'pipe', 'inherit'] });
    const rl = createInterface({ input: this.child.stdout });
    rl.on('line', (line) => {
      let msg: JsonRpcResponse;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const entry = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) entry?.reject(new Error(msg.error.message));
        else entry?.resolve(msg.result);
      }
    });
  }

  private rpc(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'verify-live-composition', version: '0.1.0' },
    });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  }

  async listToolNames(): Promise<string[]> {
    const res = (await this.rpc('tools/list', {})) as { tools: Array<{ name: string }> };
    return res.tools.map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const res = (await this.rpc('tools/call', { name, arguments: args })) as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string }>;
    };
    const text = res.content?.[0]?.text ?? '';
    if (res.isError) throw new Error(`${name}: ${text}`);
    return JSON.parse(text) as unknown;
  }

  kill(): void {
    this.child.kill();
  }
}

let failed = false;
function assert(condition: boolean, message: string): void {
  process.stdout.write(condition ? `  OK   ${message}\n` : `  FAIL ${message}\n`);
  if (!condition) failed = true;
}
function step(name: string): void {
  process.stdout.write(`\n=== ${name} ===\n`);
}

async function main(): Promise<void> {
  const clients = new Map<ServerName, McpClient>();
  try {
    step('contract: all three servers start and initialize');
    for (const [name, bundle] of Object.entries(SERVERS) as Array<[ServerName, string]>) {
      const client = new McpClient(bundle);
      await client.initialize();
      clients.set(name, client);
      assert(true, `${name} initialized over stdio`);
    }

    step('contract: boundary tools live where ADR-0002 says they live');
    const bugTools = await clients.get('github-bug-capture')!.listToolNames();
    const prTools = await clients.get('github-pull-requests')!.listToolNames();
    const planTools = await clients.get('github-sdlc-planning')!.listToolNames();

    assert(bugTools.includes('get_agent_capabilities'), 'bug-capture advertises feature detection');
    for (const owned of ['get_linked_issues', 'sync_linked_issues_project_field']) {
      assert(prTools.includes(owned), `github-pull-requests owns ${owned}`);
      assert(!bugTools.includes(owned), `bug-capture does not duplicate ${owned}`);
    }
    for (const owned of ['create_issue', 'assign_milestone', 'add_item_to_project']) {
      assert(planTools.includes(owned), `github-sdlc-planning owns ${owned}`);
      assert(!bugTools.includes(owned), `bug-capture does not duplicate ${owned}`);
    }

    const caps = (await clients.get('github-bug-capture')!.callTool('get_agent_capabilities', {})) as {
      composesWith: string[];
    };
    assert(
      caps.composesWith.includes('github-pull-requests') && caps.composesWith.includes('github-sdlc-planning'),
      'bug-capture declares both composition partners',
    );

    if (!process.env.GITHUB_TOKEN) {
      step('live: skipped (set GITHUB_TOKEN and TARGET_OWNER/TARGET_REPO to run)');
    } else {
      const owner = process.env.TARGET_OWNER ?? 'modeled-information-format';
      const repo = process.env.TARGET_REPO ?? 'gdlc-sandbox';
      step(`live: planning-side lifecycle against ${owner}/${repo}`);
      const planning = clients.get('github-sdlc-planning')!;
      const milestone = (await planning.callTool('create_milestone', {
        owner,
        repo,
        title: `composition-check ${new Date().toISOString()}`,
      })) as { number: number };
      const issue = (await planning.callTool('create_issue', {
        owner,
        repo,
        title: 'composition-check: capture-to-planning handoff',
        body: 'Filed by verify-live-composition to prove the issue boundary; safe to close.',
        mif: { id: 'composition-check', type: 'Bug', namespace: 'gdlc-sandbox' },
      })) as { number: number };
      const assigned = (await planning.callTool('assign_milestone', {
        owner,
        repo,
        issueNumber: issue.number,
        milestoneNumber: milestone.number,
      })) as { issueNumber: number; milestoneNumber: number };
      assert(
        assigned.issueNumber === issue.number && assigned.milestoneNumber === milestone.number,
        'planning assigned the filed issue to a milestone',
      );
      await planning.callTool('update_issue', { owner, repo, number: issue.number, state: 'closed' });
      assert(true, `sandbox issue #${issue.number} closed after verification`);
    }

    process.stdout.write(failed ? '\nverify-live-composition FAILED\n' : '\nverify-live-composition passed\n');
    process.exitCode = failed ? 1 : 0;
  } finally {
    for (const client of clients.values()) client.kill();
  }
}

void main();
