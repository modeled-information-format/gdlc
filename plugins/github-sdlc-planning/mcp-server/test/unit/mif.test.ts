import { describe, it, expect } from 'vitest';
import { formatMifIssueBody, parseMifIssueBody, isMifConformant, MIF_ISSUE_TYPES } from '../../src/mif.js';

describe('mif', () => {
  it('formats a MIF L1 frontmatter block ahead of the body', () => {
    const out = formatMifIssueBody({ id: 'my-epic', type: 'Epic', namespace: 'acme' }, '## Summary\nDo the thing.');
    expect(out).toBe(
      '<!-- mif-id: urn:mif:concept:acme:my-epic -->\n' +
        '<!-- mif-type: Epic -->\n' +
        '<!-- mif-ns: acme -->\n' +
        '## Summary\nDo the thing.',
    );
  });

  it('round-trips format -> parse', () => {
    const formatted = formatMifIssueBody({ id: 'sprint-4', type: 'Story', namespace: 'team-alpha' }, 'Body text here.');
    const parsed = parseMifIssueBody(formatted);
    expect(parsed.meta).toEqual({ id: 'sprint-4', type: 'Story', namespace: 'team-alpha' });
    expect(parsed.body).toBe('Body text here.');
  });

  it('reports a plain body as not MIF-conformant', () => {
    const parsed = parseMifIssueBody('Just a regular issue body, no frontmatter.');
    expect(parsed.meta).toBeNull();
    expect(parsed.body).toBe('Just a regular issue body, no frontmatter.');
    expect(isMifConformant('Just a regular issue body, no frontmatter.')).toBe(false);
  });

  it('is not conformant when only some of the three comment lines are present', () => {
    const partial = '<!-- mif-id: urn:mif:concept:acme:x -->\n<!-- mif-type: Bug -->\nBody';
    expect(isMifConformant(partial)).toBe(false);
  });

  it('exposes every issue type the feature spec names', () => {
    expect(MIF_ISSUE_TYPES).toEqual(['Initiative', 'Epic', 'Story', 'Task', 'Bug', 'Feature']);
  });
});
