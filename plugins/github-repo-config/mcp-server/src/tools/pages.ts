import { githubRest, type GithubClientDeps } from '../github-client.js';

/** Read-only: Pages is a publishing/hosting concern orthogonal to
 * planning per this domain's own finding; a status/audit read is enough
 * value without taking on the risk of a bot silently enabling/disabling
 * a repo's live site. */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface PagesConfig {
  url: string | null;
  status: string | null;
  buildType: string;
  htmlUrl: string | null;
}

interface RestPagesConfig {
  url: string | null;
  status: string | null;
  build_type: string;
  html_url: string | null;
}

export async function getPagesConfig(input: RepoRef, deps: GithubClientDeps = {}): Promise<PagesConfig> {
  const data = (await githubRest(`/repos/${input.owner}/${input.repo}/pages`, {}, deps)) as RestPagesConfig;
  return { url: data.url, status: data.status, buildType: data.build_type, htmlUrl: data.html_url };
}
