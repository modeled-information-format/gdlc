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

export const MIF_ISSUE_TYPES = ['Initiative', 'Epic', 'Story', 'Task', 'Bug', 'Feature'] as const;

export type MifIssueType = (typeof MIF_ISSUE_TYPES)[number];

export interface MifIssueMeta {
  /** Slug portion of the urn (not the full urn:mif:concept:{ns}:{slug}). */
  id: string;
  type: MifIssueType;
  namespace: string;
}

const MIF_ID_LINE = /^<!-- mif-id: (urn:mif:concept:[^\s]+) -->\n?/m;
const MIF_TYPE_LINE = /^<!-- mif-type: (Initiative|Epic|Story|Task|Bug|Feature) -->\n?/m;
const MIF_NS_LINE = /^<!-- mif-ns: ([^\s]+) -->\n?/m;

export function formatMifIssueBody(meta: MifIssueMeta, body: string): string {
  const urn = `urn:mif:concept:${meta.namespace}:${meta.id}`;
  const header = [`<!-- mif-id: ${urn} -->`, `<!-- mif-type: ${meta.type} -->`, `<!-- mif-ns: ${meta.namespace} -->`].join(
    '\n',
  );
  return `${header}\n${body}`;
}

export interface ParsedMifIssueBody {
  meta: MifIssueMeta | null;
  body: string;
}

export function parseMifIssueBody(raw: string): ParsedMifIssueBody {
  const idMatch = raw.match(MIF_ID_LINE);
  const typeMatch = raw.match(MIF_TYPE_LINE);
  const nsMatch = raw.match(MIF_NS_LINE);
  if (!idMatch || !typeMatch || !nsMatch) {
    return { meta: null, body: raw };
  }
  const urn = idMatch[1] as string;
  const slug = urn.split(':').pop() ?? '';
  const body = raw.replace(MIF_ID_LINE, '').replace(MIF_TYPE_LINE, '').replace(MIF_NS_LINE, '').replace(/^\n+/, '');
  return {
    meta: { id: slug, type: typeMatch[1] as MifIssueType, namespace: nsMatch[1] as string },
    body,
  };
}

export function isMifConformant(raw: string): boolean {
  return parseMifIssueBody(raw).meta !== null;
}
