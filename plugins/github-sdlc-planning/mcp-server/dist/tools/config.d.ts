import { z } from 'zod';
import { type GdlcConfig } from '../config.js';
export declare const targetingSectionSchema: z.ZodObject<{
    allowRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
    allowOrgs: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strict>;
export declare const destinationSectionSchema: z.ZodObject<{
    repo: z.ZodString;
}, z.core.$strict>;
export declare const boardSectionSchema: z.ZodObject<{
    projectOwnerLogin: z.ZodString;
    projectNumber: z.ZodNumber;
    projectOwnerType: z.ZodOptional<z.ZodEnum<{
        organization: "organization";
        user: "user";
    }>>;
}, z.core.$strict>;
export declare const packsSectionSchema: z.ZodRecord<z.ZodString, z.ZodBoolean>;
export declare const prLifecycleSectionSchema: z.ZodObject<{
    enabled: z.ZodOptional<z.ZodBoolean>;
    localReviewer: z.ZodOptional<z.ZodString>;
    requireLocalReview: z.ZodOptional<z.ZodBoolean>;
    requireCopilotReview: z.ZodOptional<z.ZodBoolean>;
    requireCleanCodeScanning: z.ZodOptional<z.ZodBoolean>;
    gateNewWorkOnUnresolvedThreads: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
/** Mirrors schema/gdlc-config.schema.json's per-section constraints one
 * section at a time -- write_gdlc_config validates only the section(s) a
 * caller is actually writing, never the whole merged document, since a
 * write only ever touches the sections named in its `sections` argument. */
export declare const GDLC_CONFIG_SECTION_SCHEMAS: {
    readonly targeting: z.ZodObject<{
        allowRepos: z.ZodOptional<z.ZodArray<z.ZodString>>;
        allowOrgs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>;
    readonly destination: z.ZodObject<{
        repo: z.ZodString;
    }, z.core.$strict>;
    readonly board: z.ZodObject<{
        projectOwnerLogin: z.ZodString;
        projectNumber: z.ZodNumber;
        projectOwnerType: z.ZodOptional<z.ZodEnum<{
            organization: "organization";
            user: "user";
        }>>;
    }, z.core.$strict>;
    readonly packs: z.ZodRecord<z.ZodString, z.ZodBoolean>;
    readonly prLifecycle: z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        localReviewer: z.ZodOptional<z.ZodString>;
        requireLocalReview: z.ZodOptional<z.ZodBoolean>;
        requireCopilotReview: z.ZodOptional<z.ZodBoolean>;
        requireCleanCodeScanning: z.ZodOptional<z.ZodBoolean>;
        gateNewWorkOnUnresolvedThreads: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>;
};
export type GdlcConfigSectionName = keyof typeof GDLC_CONFIG_SECTION_SCHEMAS;
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
    /** Bounds the ancestor walk (exclusive), same semantics as config.ts's
     * own ceiling parameters -- defaults to homedir(). Exposed mainly for
     * deterministic tests; production callers should rarely need to override
     * the real home-directory boundary. */
    ceiling?: string;
}
/** Wraps loadGdlcConfig with a per-layer diagnostics array -- every layer
 * path checked, whether it exists, and which top-level sections it
 * actually contributes -- so a caller (the configure-gdlc agent) can show
 * a user exactly which file set what, closing the "which file actually set
 * this" gap get_session_context's single projectConfigPath string only
 * partially covers.
 *
 * Deliberately walks every ancestor directly via walkAncestorDirs rather
 * than reusing findAllProjectConfigPaths (Copilot review finding on PR
 * #269): that function filters to existing files only, the right contract
 * for loadGdlcConfig's read cascade, but it silently hid checked-but-absent
 * candidates from this diagnostics-focused caller -- exactly the "every
 * layer path checked, whether it exists" this function's own doc comment
 * promises. loadGdlcConfig (the resolved-config half of this result) still
 * goes through the existing cascade unchanged. */
export declare function getGdlcConfig(input?: GetGdlcConfigInput, deps?: GdlcConfigFsDeps): GetGdlcConfigResult;
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
/** Per ADR-0009: (A3) mutates only the touched top-level key(s) via
 * yaml.Document.set() and re-serializes with .toString() -- never
 * parse()-to-object-then-stringify(), which would reformat every
 * untouched section. (B2) layer/root are always explicit; this function
 * never calls findProjectConfigRoot/findAllProjectConfigPaths to pick a
 * target. (C2) validates via GDLC_CONFIG_SECTION_SCHEMAS, not a new ajv
 * dependency. */
export declare function writeGdlcConfig(input: WriteGdlcConfigInput, deps?: WriteGdlcConfigFsDeps): WriteGdlcConfigResult;
