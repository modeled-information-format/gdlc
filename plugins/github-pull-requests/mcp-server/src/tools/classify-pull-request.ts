import { githubRest, type GithubClientDeps } from '../github-client.js';
import { isPrError } from '../errors.js';

export const PR_TYPES = ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf'] as const;
export const PR_RISKS = ['low', 'medium', 'high'] as const;

export type PrType = (typeof PR_TYPES)[number];
export type PrRisk = (typeof PR_RISKS)[number];
export type PrSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface ClassifyPullRequestInput {
  owner: string;
  repo: string;
  pullNumber: number;
  type: PrType;
  risk?: PrRisk;
}

export interface ClassifyPullRequestResult {
  type: PrType;
  size: PrSize;
  risk?: PrRisk;
  changedLines: number;
  changedFiles: number;
  labelsApplied: string[];
  labelsRemoved: string[];
}

interface RestPullDiffStat {
  additions: number;
  deletions: number;
  changed_files: number;
  labels: Array<{ name: string }>;
}

const TYPE_COLORS: Record<PrType, string> = {
  feat: '0E8A16',
  fix: 'D73A4A',
  chore: 'BFD4F2',
  docs: '0075CA',
  refactor: 'A371F7',
  test: 'FBCA04',
  perf: 'FF8C00',
};

const SIZE_COLORS: Record<PrSize, string> = {
  XS: '3CBF00',
  S: '5D9801',
  M: '7F6900',
  L: 'A14300',
  XL: 'D73A4A',
};

const RISK_COLORS: Record<PrRisk, string> = {
  low: '0E8A16',
  medium: 'FBCA04',
  high: 'D73A4A',
};

/** Danger.js/PR-size-labeler convention, not a novel scale. */
function bucketSize(changedLines: number): PrSize {
  if (changedLines < 10) return 'XS';
  if (changedLines < 30) return 'S';
  if (changedLines < 100) return 'M';
  if (changedLines < 500) return 'L';
  return 'XL';
}

async function labelExists(owner: string, repo: string, name: string, deps: GithubClientDeps): Promise<boolean> {
  try {
    await githubRest(`/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`, {}, deps);
    return true;
  } catch (err) {
    if (isPrError(err) && err.details.status === 404) return false;
    throw err;
  }
}

async function ensureLabel(owner: string, repo: string, name: string, color: string, deps: GithubClientDeps): Promise<void> {
  if (await labelExists(owner, repo, name, deps)) return;
  await githubRest(`/repos/${owner}/${repo}/labels`, { method: 'POST', body: { name, color } }, deps);
}

const CATEGORY_RE = /^(type|size|risk):/;

function categoryOf(label: string): 'type' | 'size' | 'risk' | null {
  const match = CATEGORY_RE.exec(label);
  return match ? (match[1] as 'type' | 'size' | 'risk') : null;
}

/** AC: same-category labels are replaced, not accumulated — a PR that grows
 * from size:S to size:XL must not wear both forever. Cross-category labels
 * are never touched (additive only). */
export async function classifyPullRequest(
  input: ClassifyPullRequestInput,
  deps: GithubClientDeps = {},
): Promise<ClassifyPullRequestResult> {
  const pr = (await githubRest(`/repos/${input.owner}/${input.repo}/pulls/${input.pullNumber}`, {}, deps)) as RestPullDiffStat;
  const changedLines = pr.additions + pr.deletions;
  const size = bucketSize(changedLines);

  const desired = [`type:${input.type}`, `size:${size}`, ...(input.risk ? [`risk:${input.risk}`] : [])];
  const desiredSet = new Set(desired);
  // A category is only managed (stale labels replaced) when this call
  // actually supplies a value for it — `risk` is optional input, and
  // omitting it must leave any existing risk: label untouched rather than
  // silently clearing it, matching type/size (always supplied) but not
  // forcing risk into that same always-managed behavior.
  const managedCategories = new Set<'type' | 'size' | 'risk'>(input.risk !== undefined ? ['type', 'size', 'risk'] : ['type', 'size']);

  const stale = pr.labels
    .map((l) => l.name)
    .filter((name) => {
      const category = categoryOf(name);
      return category !== null && managedCategories.has(category) && !desiredSet.has(name);
    });
  for (const name of stale) {
    await githubRest(`/repos/${input.owner}/${input.repo}/issues/${input.pullNumber}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }, deps);
  }

  const colors: Record<string, string> = {
    [`type:${input.type}`]: TYPE_COLORS[input.type],
    [`size:${size}`]: SIZE_COLORS[size],
    ...(input.risk ? { [`risk:${input.risk}`]: RISK_COLORS[input.risk] } : {}),
  };
  for (const name of desired) {
    await ensureLabel(input.owner, input.repo, name, colors[name] as string, deps);
  }
  await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.pullNumber}/labels`,
    { method: 'POST', body: { labels: desired } },
    deps,
  );

  return {
    type: input.type,
    size,
    risk: input.risk,
    changedLines,
    changedFiles: pr.changed_files,
    labelsApplied: desired,
    labelsRemoved: stale,
  };
}
