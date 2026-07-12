#!/usr/bin/env node
/**
 * CLI entry point for validating a gdlc/config.yml file against
 * GDLC_CONFIG_SECTION_SCHEMAS (ADR-0009) -- the one validator Story #256's
 * tools, Story #264's CI gate, and Story #264's drift-check hook all share,
 * rather than each reimplementing schema validation independently.
 *
 * Every hook in this plugin is deliberately dependency-free at runtime (no
 * node_modules resolution -- see project-profile.ts's own doc comment for
 * why), so this script is esbuild-bundled to dist/validate-gdlc-config.js
 * with zod/yaml inlined, the same way dist/pr-readiness.js in the sibling
 * github-pull-requests package is bundled. A hook or CI step invokes the
 * built dist file directly; neither needs this package's node_modules.
 *
 * Prints one JSON line to stdout ({valid, errors}); exits 0 when valid, 1
 * when invalid, 2 on a usage/read error.
 *
 *   node dist/validate-gdlc-config.js <path-to-config.yml>
 */
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { GDLC_CONFIG_SECTION_SCHEMAS, type GdlcConfigSectionName } from '../src/tools/config.js';

function isKnownSection(key: string): key is GdlcConfigSectionName {
  return Object.prototype.hasOwnProperty.call(GDLC_CONFIG_SECTION_SCHEMAS, key);
}

interface ValidationError {
  section: string;
  message: string;
}

function validate(parsed: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (parsed === null || parsed === undefined) return errors;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ section: '(root)', message: 'Document must be a YAML mapping, not a scalar or sequence' }];
  }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!isKnownSection(key)) {
      errors.push({ section: key, message: `Unknown top-level section: ${key}` });
      continue;
    }
    const result = GDLC_CONFIG_SECTION_SCHEMAS[key].safeParse(value);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({ section: key, message: `${issue.path.join('.')}: ${issue.message}` });
      }
    }
  }
  return errors;
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('Usage: node dist/validate-gdlc-config.js <path-to-config.yml>\n');
    process.exit(2);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    process.stderr.write(`Failed to read ${path}: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ valid: false, errors: [{ section: '(root)', message: `YAML syntax error: ${err instanceof Error ? err.message : String(err)}` }] })}\n`);
    process.exit(1);
  }
  const errors = validate(parsed);
  process.stdout.write(`${JSON.stringify({ valid: errors.length === 0, errors })}\n`);
  process.exit(errors.length === 0 ? 0 : 1);
}

main();
