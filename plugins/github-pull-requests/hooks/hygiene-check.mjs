#!/usr/bin/env node
// ADR-0007 (docs/decisions/adr-0007-ticket-hygiene-reinforcement-hooks.md):
// PostToolUse hook registered under three matcher groups in hooks.json --
// a plugin's own MCP tools, the generic `github` MCP server, and raw `gh`
// CLI calls via Bash -- all converging on the same detection/check logic in
// ./lib/hygiene-check.mjs. Advisory only: this script emits
// hookSpecificOutput.additionalContext on a plain exit 0, or nothing at
// all, and NEVER decision: "block" or a non-zero exit, under any
// circumstance including an unexpected internal error (see the top-level
// catch below). Canonical source of truth:
// plugins/github-sdlc-planning/hooks/hygiene-check.mjs -- github-pull-requests
// and github-bug-capture each ship a byte-identical copy at the same
// relative path (including this copy, if you're reading it from one of
// those plugins right now), kept in sync by a build-time drift check
// (AD-4, .github/workflows/ci.yml's hygiene-hook-drift-check job).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extractTouch, runHygieneChecks, buildAdditionalContext, GH_ISSUE_OR_PR_RE } from './lib/hygiene-check.mjs';
import { scratchFilePath, appendScratchEntry } from './lib/hygiene-scratch.mjs';

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function emitEmpty() {
  process.stdout.write(JSON.stringify({}));
}

function emitContext(text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: text } }));
}

/** Thin wrapper around `gh api graphql`, same shape as in-progress.mjs's
 * `runGraphQL` -- the only function in this file that talks to GitHub. */
function runGraphQL(query, variables) {
  const args = ['api', 'graphql', '-f', `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'number' || typeof value === 'boolean') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const raw = execFileSync('gh', args, { encoding: 'utf8' });
  const parsed = JSON.parse(raw);
  if (parsed.errors?.length) throw new Error(parsed.errors.map((e) => e.message).join('; '));
  return parsed.data;
}

/** Best-effort owner/repo fallback for a `gh` CLI call whose command text
 * carries no explicit owner/repo (the common case: `gh issue comment 42
 * ...` run from inside the target repo's checkout). A failure here (not a
 * git checkout, no `origin` remote, an unparseable URL) yields `null` --
 * the affected check(s) then simply have nothing to resolve, never a
 * guess. */
function fallbackOwnerRepoFromCwd(cwd) {
  try {
    const url = execFileSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const match = /[:/]([^/:]+)\/([^/.]+?)(?:\.git)?$/.exec(url);
    if (!match) return null;
    return { owner: match[1], repo: match[2] };
  } catch {
    return null;
  }
}

async function main() {
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();

  // This hook is registered on the broad `Bash` matcher (hooks.json), so it
  // runs for every single Bash tool call, not just `gh issue|pr` ones. The
  // git-remote shell-out below is real overhead; gate it behind the same
  // cheap, pure regex test extractTouch's own Bash branch uses, so an
  // unrelated command (`ls`, `npm test`, ...) never pays for it.
  let fallbackOwnerRepo = null;
  if (input.tool_name === 'Bash' && GH_ISSUE_OR_PR_RE.test(String(input.tool_input?.command ?? ''))) {
    fallbackOwnerRepo = fallbackOwnerRepoFromCwd(cwd);
  }

  const touch = extractTouch(input, fallbackOwnerRepo);
  if (!touch) {
    emitEmpty();
    return;
  }

  const findings = await runHygieneChecks(touch, {
    runGraphQL,
    transcriptPath: input.transcript_path,
    // No readFn override: lib/hygiene-check.mjs's own default
    // (readTranscriptTail) bounds the read to a fixed tail window rather
    // than loading the whole, potentially large, session transcript.
  });

  if (input.session_id) {
    appendScratchEntry(scratchFilePath(input.session_id), {
      ts: input.timestamp ?? null,
      surface: touch.surface,
      action: touch.action,
      owner: touch.owner,
      repo: touch.repo,
      number: touch.number,
      findings,
    });
  }

  const context = buildAdditionalContext(findings);
  if (context) {
    emitContext(context);
    return;
  }
  emitEmpty();
}

// Top-level catch: the non-blocking contract must hold even on an
// unanticipated throw anywhere above -- a hook must never break the tool
// call it observes.
main().catch(() => emitEmpty());
