import { githubGet, type GithubClientDeps } from '../github-client.js';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface TrafficDailyPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface TrafficSummary {
  count: number;
  uniques: number;
  daily: TrafficDailyPoint[];
}

interface RestTrafficSummary {
  count: number;
  uniques: number;
  views?: RestDailyPoint[];
  clones?: RestDailyPoint[];
}

interface RestDailyPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

/** 14-day rolling window, per GitHub's own documented retention. */
export async function getRepoTrafficViews(input: RepoRef, deps: GithubClientDeps = {}): Promise<TrafficSummary> {
  const data = (await githubGet(`/repos/${input.owner}/${input.repo}/traffic/views`, deps)) as RestTrafficSummary;
  return { count: data.count, uniques: data.uniques, daily: data.views ?? [] };
}

export async function getRepoTrafficClones(input: RepoRef, deps: GithubClientDeps = {}): Promise<TrafficSummary> {
  const data = (await githubGet(`/repos/${input.owner}/${input.repo}/traffic/clones`, deps)) as RestTrafficSummary;
  return { count: data.count, uniques: data.uniques, daily: data.clones ?? [] };
}
