/** MIF L1 frontmatter for issue/discussion bodies (feature-spec AC-1):
 *
 *   <!-- mif-id: urn:mif:concept:{namespace}:{slug} -->
 *   <!-- mif-type: [Initiative|Epic|Story|Task|Bug|Feature] -->
 *   <!-- mif-ns: {namespace} -->
 *   <standard Markdown body>
 *
 * Implemented natively here (not delegated to the mif-docs skill set) because
 * it is a data-format concern every MCP host needs identically — the
 * cross-agent portability floor. The Claude Code enhancement layer
 * additionally invokes mif-docs:mif-validate as a richer conformance gate,
 * and the project-setup skill invokes mif-docs:mif-frontmatter directly for
 * longer-form planning documents (sprint-plan write-ups, setup reports)
 * beyond this simple per-issue comment block. */
export declare const MIF_ISSUE_TYPES: readonly ["Initiative", "Epic", "Story", "Task", "Bug", "Feature"];
export type MifIssueType = (typeof MIF_ISSUE_TYPES)[number];
export interface MifIssueMeta {
    /** Slug portion of the urn (not the full urn:mif:concept:{ns}:{slug}). */
    id: string;
    type: MifIssueType;
    namespace: string;
}
export declare function formatMifIssueBody(meta: MifIssueMeta, body: string): string;
export interface ParsedMifIssueBody {
    meta: MifIssueMeta | null;
    body: string;
}
export declare function parseMifIssueBody(raw: string): ParsedMifIssueBody;
export declare function isMifConformant(raw: string): boolean;
