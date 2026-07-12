import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { Document, parseDocument } from 'yaml';
import { z } from 'zod';

import {
  resolveConfigPath,
  resolveGlobalConfigRoot,
  loadConfigFile,
  loadGdlcConfig,
  findAllProjectConfigPaths,
  type GdlcConfig,
} from '../config.js';
import { PlanningError } from '../errors.js';

/** ADR-0009: get_gdlc_config/write_gdlc_config. get_gdlc_config is a thin
 * diagnostics-carrying wrapper over config.ts's existing read-side cascade
 * (loadGdlcConfig/findAllProjectConfigPaths) -- it does not reimplement the
 * cascade. write_gdlc_config is new: per ADR-0009's three decisions, it
 * (A3) mutates only the touched top-level key(s) via yaml's Document API
 * rather than parse-to-object-then-stringify, (B2) always takes an explicit
 * layer/root rather than inferring one via ancestor search, and (C2)
 * validates against a hand-written zod schema mirroring
 * schema/gdlc-config.schema.json rather than adding an ajv dependency. */

const orgRepoPattern = /^[^/\s]+\/[^/\s]+$/;
const orgPattern = /^[^/\s]+$/;

export const targetingSectionSchema = z
  .object({
    allowRepos: z.array(z.string().regex(orgRepoPattern)).optional(),
    allowOrgs: z.array(z.string().regex(orgPattern)).optional(),
  })
  .strict();

export const destinationSectionSchema = z
  .object({
    repo: z.string().regex(orgRepoPattern),
  })
  .strict();

export const boardSectionSchema = z
  .object({
    projectOwnerLogin: z.string().min(1),
    projectNumber: z.number().int().min(1),
    projectOwnerType: z.enum(['organization', 'user']).optional(),
  })
  .strict();

export const packsSectionSchema = z.record(z.string(), z.boolean());

export const prLifecycleSectionSchema = z
  .object({
    enabled: z.boolean().optional(),
    localReviewer: z.string().min(1).optional(),
    requireLocalReview: z.boolean().optional(),
    requireCopilotReview: z.boolean().optional(),
    requireCleanCodeScanning: z.boolean().optional(),
    gateNewWorkOnUnresolvedThreads: z.boolean().optional(),
  })
  .strict();

/** Mirrors schema/gdlc-config.schema.json's per-section constraints one
 * section at a time -- write_gdlc_config validates only the section(s) a
 * caller is actually writing, never the whole merged document, since a
 * write only ever touches the sections named in its `sections` argument. */
export const GDLC_CONFIG_SECTION_SCHEMAS = {
  targeting: targetingSectionSchema,
  destination: destinationSectionSchema,
  board: boardSectionSchema,
  packs: packsSectionSchema,
  prLifecycle: prLifecycleSectionSchema,
} as const;

export type GdlcConfigSectionName = keyof typeof GDLC_CONFIG_SECTION_SCHEMAS;

function isKnownSection(key: string): key is GdlcConfigSectionName {
  return Object.prototype.hasOwnProperty.call(GDLC_CONFIG_SECTION_SCHEMAS, key);
}

export interface GdlcConfigLayerDiagnostic {
  layer: 'global' | 'project';
  path: string;
  exists: boolean;
  sections: string[];
}

export interface GetGdlcConfigInput {
  startDir?: string;
}

export interface GetGdlcConfigResult {
  resolved: GdlcConfig;
  layers: GdlcConfigLayerDiagnostic[];
}

export interface GdlcConfigFsDeps {
  existsFn?: (path: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

/** Wraps loadGdlcConfig/findAllProjectConfigPaths with a per-layer
 * diagnostics array -- every layer path checked, whether it exists, and
 * which top-level sections it actually contributes -- so a caller (the
 * configure-gdlc agent) can show a user exactly which file set what,
 * closing the "which file actually set this" gap get_session_context's
 * single projectConfigPath string only partially covers. */
export function getGdlcConfig(input: GetGdlcConfigInput = {}, deps: GdlcConfigFsDeps = {}): GetGdlcConfigResult {
  const existsFn = deps.existsFn ?? existsSync;
  const env = deps.env ?? process.env;
  const startDir = input.startDir ?? process.cwd();

  const globalPath = resolveConfigPath(resolveGlobalConfigRoot(env));
  const globalExists = existsFn(globalPath);
  const layers: GdlcConfigLayerDiagnostic[] = [
    {
      layer: 'global',
      path: globalPath,
      exists: globalExists,
      sections: globalExists ? Object.keys(loadConfigFile(globalPath)) : [],
    },
  ];

  for (const path of findAllProjectConfigPaths(startDir, existsFn, env)) {
    layers.push({ layer: 'project', path, exists: true, sections: Object.keys(loadConfigFile(path)) });
  }

  return { resolved: loadGdlcConfig(startDir, env, existsFn), layers };
}

export interface WriteGdlcConfigInput {
  layer: 'project' | 'global';
  /** Only consulted when layer === 'project'. Defaults to process.cwd() --
   * per ADR-0009 (B2), NEVER an ancestor-search result. A caller wanting to
   * edit an already-found ancestor file must pass its directory explicitly. */
  root?: string;
  sections: Partial<Record<GdlcConfigSectionName, unknown>>;
  /** When true, returns the would-be file content without touching disk --
   * the configure-gdlc agent's confirm-before-write step. */
  dryRun?: boolean;
}

export interface WriteGdlcConfigResult {
  path: string;
  dryRun: boolean;
  written: boolean;
  content: string;
}

export interface WriteGdlcConfigFsDeps {
  existsFn?: (path: string) => boolean;
  readFileFn?: (path: string) => string;
  writeFileFn?: (path: string, content: string) => void;
  mkdirFn?: (path: string) => void;
  env?: NodeJS.ProcessEnv;
}

function validateSections(sections: Partial<Record<GdlcConfigSectionName, unknown>>): void {
  for (const [key, value] of Object.entries(sections)) {
    if (!isKnownSection(key)) {
      throw new PlanningError('invalid_config', `Unknown config section: ${key}`, { section: key });
    }
    const schema = GDLC_CONFIG_SECTION_SCHEMAS[key];
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new PlanningError('invalid_config', `Section "${key}" failed validation`, {
        section: key,
        issues: result.error.issues,
      });
    }
  }
}

/** Per ADR-0009: (A3) mutates only the touched top-level key(s) via
 * yaml.Document.set() and re-serializes with .toString() -- never
 * parse()-to-object-then-stringify(), which would reformat every
 * untouched section. (B2) layer/root are always explicit; this function
 * never calls findProjectConfigRoot/findAllProjectConfigPaths to pick a
 * target. (C2) validates via GDLC_CONFIG_SECTION_SCHEMAS, not a new ajv
 * dependency. */
export function writeGdlcConfig(input: WriteGdlcConfigInput, deps: WriteGdlcConfigFsDeps = {}): WriteGdlcConfigResult {
  const existsFn = deps.existsFn ?? existsSync;
  const readFileFn = deps.readFileFn ?? ((path: string) => readFileSync(path, 'utf8'));
  const writeFileFn = deps.writeFileFn ?? ((path: string, content: string) => writeFileSync(path, content));
  const mkdirFn = deps.mkdirFn ?? ((path: string) => mkdirSync(path, { recursive: true }));
  const env = deps.env ?? process.env;

  validateSections(input.sections);

  const root = input.layer === 'global' ? resolveGlobalConfigRoot(env) : (input.root ?? process.cwd());
  const configDirRoot = input.layer === 'global' ? root : `${root}/.config`;
  const path = resolveConfigPath(configDirRoot);

  const exists = existsFn(path);
  const doc = exists ? parseDocument(readFileFn(path)) : new Document();
  for (const [key, value] of Object.entries(input.sections)) {
    doc.set(key, value);
  }
  // flowCollectionPadding defaults to true in the yaml package's stringifier,
  // which pads inline arrays ("[a]" -> "[ a ]") on every re-serialize even
  // for untouched keys. false matches the padding-less style this repo's
  // existing gdlc/config.yml files already use, keeping an untouched
  // section's flow collections byte-identical, not just its comments/order.
  const content = doc.toString({ flowCollectionPadding: false });

  if (input.dryRun) {
    return { path, dryRun: true, written: false, content };
  }

  mkdirFn(dirname(path));
  writeFileFn(path, content);
  return { path, dryRun: false, written: true, content };
}
