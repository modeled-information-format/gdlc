import { describe, it, expect } from 'vitest';
import { mockGraphQL, mockRest } from '../helpers.js';
import { getLinkedIssues } from '../../src/tools/linked-issues.js';

describe('getLinkedIssues', () => {
  it('AC-3: prefers closingIssuesReferences and cross-references the MIF block (AC-5)', async () => {
    mockGraphQL(() => ({
      repository: {
        pullRequest: {
          body: 'Fixes #7',
          closingIssuesReferences: { nodes: [{ number: 7, repository: { nameWithOwner: 'acme/widgets' } }] },
        },
      },
    }));
    mockRest('get', '/repos/acme/widgets/issues/7', {
      body: '<!-- mif-id: urn:mif:concept:acme:x -->\n<!-- mif-type: Task -->\n<!-- mif-ns: acme -->\nBody',
    });

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 1 });
    expect(result.sourceAttempted).toEqual(['closing_reference']);
    expect(result.items).toEqual([
      { number: 7, repo: 'acme/widgets', source: 'closing_reference', closing: true, alreadyTracked: true },
    ]);
  });

  it('AC-4: falls back to heuristic parsing when closingIssuesReferences is empty', async () => {
    mockGraphQL(() => ({
      repository: {
        pullRequest: { body: 'See also #42 for context.', closingIssuesReferences: { nodes: [] } },
      },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/2/commits', []);
    mockRest('get', '/repos/acme/widgets/issues/2/timeline', []);
    mockRest('get', '/repos/acme/widgets/issues/42', { body: 'plain body, not tracked' });

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 2 });
    expect(result.sourceAttempted).toEqual(['closing_reference', 'heuristic']);
    expect(result.items).toEqual([
      { number: 42, repo: 'acme/widgets', source: 'heuristic', closing: false, alreadyTracked: false },
    ]);
  });

  it('Edge Case: no linked issues found by either path returns an empty array, not an error', async () => {
    mockGraphQL(() => ({
      repository: { pullRequest: { body: 'Nothing to see here.', closingIssuesReferences: { nodes: [] } } },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/3/commits', []);
    mockRest('get', '/repos/acme/widgets/issues/3/timeline', []);

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 3 });
    expect(result.items).toEqual([]);
    expect(result.sourceAttempted).toEqual(['closing_reference', 'heuristic']);
  });

  it('Edge Case: a closing-keyword match in the heuristic path is labeled closing: true', async () => {
    mockGraphQL(() => ({
      repository: { pullRequest: { body: 'Closes #99', closingIssuesReferences: { nodes: [] } } },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/4/commits', []);
    mockRest('get', '/repos/acme/widgets/issues/4/timeline', []);
    mockRest('get', '/repos/acme/widgets/issues/99', { body: 'plain' });

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 4 });
    expect(result.items).toEqual([{ number: 99, repo: 'acme/widgets', source: 'heuristic', closing: true, alreadyTracked: false }]);
  });

  it('picks up a cross-referenced issue from the Timeline API, excluding PRs that reference this one', async () => {
    mockGraphQL(() => ({
      repository: { pullRequest: { body: 'no reference here', closingIssuesReferences: { nodes: [] } } },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/6/commits', []);
    mockRest('get', '/repos/acme/widgets/issues/6/timeline', [
      { event: 'commented' },
      { event: 'cross-referenced', source: { issue: { number: 88, pull_request: { url: 'x' } } } },
      { event: 'cross-referenced', source: { issue: { number: 77 } } },
    ]);
    mockRest('get', '/repos/acme/widgets/issues/77', { body: 'plain' });

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 6 });
    expect(result.items.map((i) => i.number)).toEqual([77]);
  });

  it('treats a fetch failure on commits/timeline as empty, not a hard error', async () => {
    mockGraphQL(() => ({
      repository: { pullRequest: { body: 'Closes #33', closingIssuesReferences: { nodes: [] } } },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/7/commits', { message: 'Not Found' }, 404);
    mockRest('get', '/repos/acme/widgets/issues/7/timeline', { message: 'Not Found' }, 404);
    mockRest('get', '/repos/acme/widgets/issues/33', { message: 'Not Found' }, 404);

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 7 });
    // isAlreadyTracked also swallows its own fetch failure and reports false.
    expect(result.items).toEqual([{ number: 33, repo: 'acme/widgets', source: 'heuristic', closing: true, alreadyTracked: false }]);
  });

  it('picks up a bare reference from a commit message', async () => {
    mockGraphQL(() => ({
      repository: { pullRequest: { body: 'no reference here', closingIssuesReferences: { nodes: [] } } },
    }));
    mockRest('get', '/repos/acme/widgets/pulls/5/commits', [{ commit: { message: 'wip on #55' } }]);
    mockRest('get', '/repos/acme/widgets/issues/5/timeline', []);
    mockRest('get', '/repos/acme/widgets/issues/55', { body: 'plain' });

    const result = await getLinkedIssues({ owner: 'acme', repo: 'widgets', pullNumber: 5 });
    expect(result.items).toEqual([{ number: 55, repo: 'acme/widgets', source: 'heuristic', closing: false, alreadyTracked: false }]);
  });
});
