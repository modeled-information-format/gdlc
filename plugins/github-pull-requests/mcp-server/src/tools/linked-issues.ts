import { githubGraphQL, githubRest, type GithubClientDeps } from '../github-client.js';
import { parseMifIssueBody } from '@github-sdlc-plugins/github-sdlc-planning-mcp-server/mif';
import type { PullRequestRef } from './reviews.js';

export type LinkedIssueSource = 'closing_reference' | 'heuristic';

export interface LinkedIssueResult {
  number: number;
  repo: string;
  source: LinkedIssueSource;
  closing: boolean;
  /** AC-5 / Edge Case (cross-plugin double-count): true when the target
   * issue already carries a github-sdlc-planning MIF comment block, so a
   * caller doesn't re-synthesize it as a new planning unit. Read via the
   * shared parser, never a duplicated one. */
  alreadyTracked: boolean;
}

export interface GetLinkedIssuesResult {
  items: LinkedIssueResult[];
  sourceAttempted: LinkedIssueSource[];
}

const CLOSING_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        body
        closingIssuesReferences(first: 50) {
          nodes { number repository { nameWithOwner } }
        }
      }
    }
  }
`;

interface ClosingIssuesResponse {
  repository: {
    pullRequest: {
      body: string;
      closingIssuesReferences: { nodes: Array<{ number: number; repository: { nameWithOwner: string } }> };
    };
  };
}

const CLOSING_KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*#(\d+)/gi;
const BARE_REF_RE = /#(\d+)/g;

interface TimelineEvent {
  event: string;
  source?: { issue?: { number: number; pull_request?: unknown } };
}

async function fetchTimelineCrossReferences(ref: PullRequestRef, deps: GithubClientDeps): Promise<number[]> {
  const events = (await githubRest(`/repos/${ref.owner}/${ref.repo}/issues/${ref.pullNumber}/timeline`, {}, deps)) as TimelineEvent[];
  const numbers: number[] = [];
  for (const e of events) {
    if (e.event === 'cross-referenced' && e.source?.issue && e.source.issue.pull_request === undefined) {
      numbers.push(e.source.issue.number);
    }
  }
  return numbers;
}

interface CommitListItem {
  commit: { message: string };
}

async function fetchCommitMessages(ref: PullRequestRef, deps: GithubClientDeps): Promise<string[]> {
  const commits = (await githubRest(`/repos/${ref.owner}/${ref.repo}/pulls/${ref.pullNumber}/commits`, {}, deps)) as CommitListItem[];
  return commits.map((c) => c.commit.message);
}

async function isAlreadyTracked(owner: string, repo: string, issueNumber: number, deps: GithubClientDeps): Promise<boolean> {
  try {
    const issue = (await githubRest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {}, deps)) as { body?: string };
    return parseMifIssueBody(issue.body ?? '').meta !== null;
  } catch {
    return false;
  }
}

function collectMatches(texts: string[]): { closingKeyword: Set<number>; bare: Set<number> } {
  const closingKeyword = new Set<number>();
  const bare = new Set<number>();
  for (const text of texts) {
    for (const m of text.matchAll(CLOSING_KEYWORD_RE)) {
      const n = m[1];
      if (n) closingKeyword.add(Number(n));
    }
    for (const m of text.matchAll(BARE_REF_RE)) {
      const n = m[1];
      if (n) bare.add(Number(n));
    }
  }
  return { closingKeyword, bare };
}

/** AC-3: prefer the GraphQL closingIssuesReferences field. AC-4 (known gap):
 * fall back to Timeline API + PR body/commit text-parsing, labeled
 * `confidence: heuristic` — never presented with closing_reference's
 * confidence. */
export async function getLinkedIssues(ref: PullRequestRef, deps: GithubClientDeps = {}): Promise<GetLinkedIssuesResult> {
  const data = await githubGraphQL<ClosingIssuesResponse>(
    CLOSING_ISSUES_QUERY,
    { owner: ref.owner, repo: ref.repo, number: ref.pullNumber },
    deps,
  );
  const closingNodes = data.repository.pullRequest.closingIssuesReferences.nodes;
  const sourceAttempted: LinkedIssueSource[] = ['closing_reference'];

  if (closingNodes.length > 0) {
    const items: LinkedIssueResult[] = [];
    for (const node of closingNodes) {
      const parts = node.repository.nameWithOwner.split('/');
      const nodeOwner = parts[0] ?? ref.owner;
      const nodeRepo = parts[1] ?? ref.repo;
      items.push({
        number: node.number,
        repo: node.repository.nameWithOwner,
        source: 'closing_reference',
        closing: true,
        alreadyTracked: await isAlreadyTracked(nodeOwner, nodeRepo, node.number, deps),
      });
    }
    return { items, sourceAttempted };
  }

  sourceAttempted.push('heuristic');
  const [commitMessages, timelineNumbers] = await Promise.all([
    fetchCommitMessages(ref, deps).catch(() => []),
    fetchTimelineCrossReferences(ref, deps).catch(() => []),
  ]);
  const { closingKeyword, bare } = collectMatches([data.repository.pullRequest.body ?? '', ...commitMessages]);
  const allNumbers = new Set<number>([...closingKeyword, ...bare, ...timelineNumbers]);

  const items: LinkedIssueResult[] = [];
  for (const number of allNumbers) {
    items.push({
      number,
      repo: `${ref.owner}/${ref.repo}`,
      source: 'heuristic',
      closing: closingKeyword.has(number),
      alreadyTracked: await isAlreadyTracked(ref.owner, ref.repo, number, deps),
    });
  }
  return { items, sourceAttempted };
}
