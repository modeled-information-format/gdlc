#!/usr/bin/env node
// AC-8: SessionStart hook — fetches open milestones for the current repo (via
// its git remote) and injects them as additionalContext. Shells out to `gh`
// directly rather than the MCP server: a hook is a separate process outside
// the MCP JSON-RPC session, so it uses the same generic-layer `gh` CLI path
// any non-Claude-Code agent would (graceful-degradation contract — this hook
// is UX-additive, never the only path to the same information; a hook-less
// host gets the same data via the get_session_context MCP tool).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function resolveOwnerRepo(cwd) {
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = url.match(/github\.com[:/]([^/]+)\/([^/.]+?)(\.git)?$/);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();
  const target = resolveOwnerRepo(cwd);
  if (!target) {
    // Not a GitHub repo, or no remote configured — nothing to inject. This is
    // a normal, non-error outcome (e.g. a fresh scratch directory).
    process.stdout.write(JSON.stringify({}));
    return;
  }
  try {
    const raw = execFileSync(
      'gh',
      ['api', `repos/${target.owner}/${target.repo}/milestones?state=open`, '--jq', '[.[] | {number, title, due_on}]'],
      { encoding: 'utf8' },
    );
    const milestones = JSON.parse(raw);
    const summary =
      milestones.length === 0
        ? `No open milestones in ${target.owner}/${target.repo}.`
        : `Open milestones in ${target.owner}/${target.repo}: ${milestones
            .map((m) => `#${m.number} "${m.title}"${m.due_on ? ` (due ${m.due_on})` : ''}`)
            .join(', ')}.`;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: summary },
      }),
    );
  } catch {
    // gh not authenticated, repo not accessible, etc. — degrade silently;
    // get_session_context remains available as an explicit fallback.
    process.stdout.write(JSON.stringify({}));
  }
}

main();
