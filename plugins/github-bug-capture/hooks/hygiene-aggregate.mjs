#!/usr/bin/env node
// ADR-0007: Stop/SubagentStop hook -- the end-of-turn backstop that
// consolidates this turn's hygiene-check.mjs scratch entries into ONE
// reminder (AD-3, NFR-6). Advisory only, same non-blocking contract as
// hygiene-check.mjs: plain exit 0, hookSpecificOutput.additionalContext or
// nothing, never decision: "block". Canonical source of truth:
// plugins/github-sdlc-planning/hooks/hygiene-aggregate.mjs -- github-pull-requests
// and github-bug-capture each ship a byte-identical copy at the same
// relative path (including this copy, if you're reading it from one of
// those plugins right now), kept in sync by a build-time drift check
// (AD-4, .github/workflows/ci.yml's hygiene-hook-drift-check job).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readScratchEntries, scratchFilePath, clearScratch } from './lib/hygiene-scratch.mjs';
import { buildConsolidatedContext } from './lib/hygiene-aggregate.mjs';

/** gdlc#324: thin wrapper around `gh api graphql`, byte-for-byte the same
 * shape as hygiene-check.mjs's own `runGraphQL` -- this is now the second
 * (and only other) place in this hook family that talks to GitHub, needed
 * so `buildConsolidatedContext`'s live-comment fallback can fire at Stop
 * time, not just at PostToolUse time. */
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

function readStdin() {
  try {
    const parsed = JSON.parse(readFileSync(0, 'utf8'));
    // JSON.parse succeeds on `null`/an array/a bare primitive just as
    // readily as on an object; only a plain object is a valid hook
    // envelope, so anything else falls back to `{}` the same way a parse
    // failure already does.
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function emitEmpty() {
  process.stdout.write(JSON.stringify({}));
}

function emitContext(hookEventName, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }));
}

// gdlc#324: async now that buildConsolidatedContext's live-comment fallback
// can make a network call (matching hygiene-check.mjs's own async main).
async function main() {
  const input = readStdin();
  if (!input.session_id) {
    emitEmpty();
    return;
  }

  const path = scratchFilePath(input.session_id);
  const entries = readScratchEntries(path);
  const context = await buildConsolidatedContext(entries, input.transcript_path, undefined, runGraphQL);

  // Clear regardless of whether there was anything to report: a turn with
  // zero findings should not have its (empty-findings) entries re-read and
  // re-considered by the next Stop event in the same session.
  clearScratch(path);

  if (context) {
    emitContext(input.hook_event_name ?? 'Stop', context);
    return;
  }
  emitEmpty();
}

// Top-level catch, matching hygiene-check.mjs: the non-blocking contract
// must hold even on an unanticipated throw anywhere above (e.g. a
// malformed scratch-file entry reaching buildConsolidatedContext) -- a
// hook must never break the tool call it observes.
main().catch(() => emitEmpty());
