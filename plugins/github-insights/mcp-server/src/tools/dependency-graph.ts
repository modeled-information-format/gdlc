import { githubGet, type GithubClientDeps } from '../github-client.js';

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Deliberately thin: the full SPDX SBOM document is a large, deeply
 * nested external schema. Modeling every field is out of scope here --
 * this surfaces just enough (spec version, package count) to answer "is
 * there an SBOM and roughly how big is it," not to be a full SPDX
 * client. */
export interface DependencyGraphSummary {
  spdxVersion: string;
  packageCount: number;
}

interface RestSbomResponse {
  sbom: {
    spdxVersion: string;
    packages: unknown[];
  };
}

export async function getDependencyGraphSbom(input: RepoRef, deps: GithubClientDeps = {}): Promise<DependencyGraphSummary> {
  const data = (await githubGet(`/repos/${input.owner}/${input.repo}/dependency-graph/sbom`, deps)) as RestSbomResponse;
  return { spdxVersion: data.sbom.spdxVersion, packageCount: data.sbom.packages.length };
}
