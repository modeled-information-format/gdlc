/**
 * Diagnostic-capture detection — the hooks-pack's testable core (issue #39).
 *
 * Deliberately plain text-signature matching over whatever text a tool
 * produced (Bash stdout/stderr, or the tail of the session transcript),
 * not exit-code inspection or a per-language test/lint/build parser: hook
 * stdin already hands over text, and the signatures below are the common,
 * language-agnostic markers a failure leaves behind. Dependency-free, same
 * spirit as hooks/lib/settings.mjs, so hooks can run it with bare `node`.
 */
import { readFileSync } from 'node:fs';

/** Ordered so the first match wins when several signatures could apply.
 * Anchored to line start (allowing leading whitespace, and Go's `--- `
 * prefix for test-failure) rather than matching anywhere in the text: a
 * real test-runner/compiler/linter marker starts its own line, whereas
 * mid-sentence prose ("this suite does not FAIL under normal conditions")
 * does not. generic-error is the least precise signature by design --
 * plain "Error:" at line start still has real false-positive potential
 * against --help-style text formatted one option per line -- accepted as
 * a low-cost tradeoff since this hook only injects informational context
 * for an opt-in, default-off pack; it never files an issue or mutates
 * anything on its own. */
export const FAILURE_SIGNATURES = [
  { name: 'test-failure', pattern: /^\s*(?:---\s*)?FAIL\b/m },
  { name: 'typescript-error', pattern: /error TS\d+:/ },
  { name: 'lint-error', pattern: /^\s*\d+:\d+\s+error\s/m },
  { name: 'nonzero-exit', pattern: /exit code (?!0\b)\d+/i },
  { name: 'generic-error', pattern: /^\s*Error:\s/m },
];

const EXCERPT_RADIUS = 160;

/** Scan `text` for the first known failure signature. Returns
 * `{ detected: false }` for clean output, or `{ detected: true, signature,
 * excerpt }` with a short window of context around the match. */
export function detectFailure(text) {
  const value = String(text ?? '');
  for (const { name, pattern } of FAILURE_SIGNATURES) {
    const match = pattern.exec(value);
    if (match) {
      const start = Math.max(0, match.index - EXCERPT_RADIUS);
      const end = Math.min(value.length, match.index + EXCERPT_RADIUS);
      return { detected: true, signature: name, excerpt: value.slice(start, end).trim() };
    }
  }
  return { detected: false };
}

/** A Bash tool_output may arrive as a plain string or an object carrying
 * stdout/stderr/output fields — handle both without assuming one shape. */
export function extractOutputText(toolOutput) {
  if (toolOutput == null) return '';
  if (typeof toolOutput === 'string') return toolOutput;
  if (typeof toolOutput !== 'object') return '';
  const parts = [];
  for (const key of ['output', 'stdout', 'stderr']) {
    const value = toolOutput[key];
    if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n');
}

/** Read the tail of a file (a session transcript, in practice) and run the
 * same signature scan over it. Missing/unreadable files are a clean no-op,
 * matching isPackEnabled's fail-closed style. */
export function detectFailureInFile(path, tailBytes = 20000) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { detected: false };
  }
  const tail = text.length > tailBytes ? text.slice(text.length - tailBytes) : text;
  return detectFailure(tail);
}

export function buildAdditionalContext(detection) {
  return [
    `The hooks-pack's diagnostic-capture detected a "${detection.signature}" signature in recent tool output:`,
    '',
    detection.excerpt,
    '',
    'If this looks like a real defect, use the file-bug skill (triage-skill-pack) to capture it as a ' +
      'structured issue with this diagnostic attached. This is informational only — no issue has been filed.',
  ].join('\n');
}
