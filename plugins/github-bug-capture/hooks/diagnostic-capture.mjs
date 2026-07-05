#!/usr/bin/env node
// Hooks-pack (issue #39): a thin CLI wrapper around hooks/lib/diagnostic-capture.mjs's
// pure detection functions. Registered twice in hooks.json under two argv modes:
//   post-tool-use — scans the just-completed Bash tool's output directly.
//   stop          — a safety net: scans the tail of the session transcript, in case
//                    a failure surfaced but the agent moved on without acting on it.
// A disabled pack (isPackEnabled('hooks', ...) false) is always a silent no-op.
import { readFileSync } from 'node:fs';
import { isPackEnabled } from './lib/settings.mjs';
import { detectFailure, extractOutputText, detectFailureInFile, buildAdditionalContext } from './lib/diagnostic-capture.mjs';

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

function emitContext(hookEventName, text) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext: text } }));
}

function main() {
  const mode = process.argv[2];
  const input = readStdin();
  const cwd = input.cwd ?? process.cwd();

  if (!isPackEnabled('hooks', cwd)) {
    emitEmpty();
    return;
  }

  if (mode === 'stop') {
    const detection = input.transcript_path ? detectFailureInFile(input.transcript_path) : { detected: false };
    if (detection.detected) {
      emitContext('Stop', buildAdditionalContext(detection));
      return;
    }
    emitEmpty();
    return;
  }

  const detection = detectFailure(extractOutputText(input.tool_output));
  if (detection.detected) {
    emitContext('PostToolUse', buildAdditionalContext(detection));
    return;
  }
  emitEmpty();
}

main();
