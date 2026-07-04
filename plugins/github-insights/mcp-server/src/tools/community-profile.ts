import { githubGet, type GithubClientDeps } from '../github-client.js';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface CommunityProfile {
  healthPercentage: number;
  description: string | null;
  hasReadme: boolean;
  hasLicense: boolean;
  hasContributing: boolean;
  hasCodeOfConduct: boolean;
  hasIssueTemplate: boolean;
  hasPullRequestTemplate: boolean;
}

interface RestCommunityProfile {
  health_percentage: number;
  description: string | null;
  files: {
    readme: unknown | null;
    license: unknown | null;
    contributing: unknown | null;
    code_of_conduct: unknown | null;
    issue_template: unknown | null;
    pull_request_template: unknown | null;
  };
}

export async function getCommunityProfile(input: RepoRef, deps: GithubClientDeps = {}): Promise<CommunityProfile> {
  const data = (await githubGet(`/repos/${input.owner}/${input.repo}/community/profile`, deps)) as RestCommunityProfile;
  return {
    healthPercentage: data.health_percentage,
    description: data.description,
    hasReadme: data.files.readme !== null,
    hasLicense: data.files.license !== null,
    hasContributing: data.files.contributing !== null,
    hasCodeOfConduct: data.files.code_of_conduct !== null,
    hasIssueTemplate: data.files.issue_template !== null,
    hasPullRequestTemplate: data.files.pull_request_template !== null,
  };
}
