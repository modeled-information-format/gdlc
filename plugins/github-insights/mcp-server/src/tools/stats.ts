import { githubGet, type GithubClientDeps } from '../github-client.js';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface ContributorStat {
  login: string | null;
  total: number;
}

export interface ContributorStatsResult {
  /** GitHub computes these stats asynchronously on a cache miss and
   * returns 202 with an empty body while doing so -- the caller should
   * retry shortly rather than treat this as "zero contributors". */
  computing: boolean;
  contributors: ContributorStat[];
}

interface RestContributorStat {
  author: { login: string } | null;
  total: number;
}

export async function getRepoContributorStats(input: RepoRef, deps: GithubClientDeps = {}): Promise<ContributorStatsResult> {
  const data = (await githubGet(`/repos/${input.owner}/${input.repo}/stats/contributors`, deps)) as RestContributorStat[] | undefined;
  if (data === undefined) {
    return { computing: true, contributors: [] };
  }
  return { computing: false, contributors: data.map((c) => ({ login: c.author?.login ?? null, total: c.total })) };
}
