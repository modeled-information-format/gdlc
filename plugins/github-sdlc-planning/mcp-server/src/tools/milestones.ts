import { githubRest, type GithubClientDeps } from '../github-client.js';

/** Milestones are REST-only — GraphQL exposes them read-only, so every write
 * here goes through REST (feature-spec Design section). */

export interface CreateMilestoneInput {
  owner: string;
  repo: string;
  title: string;
  description?: string;
  dueOn?: string;
  state?: 'open' | 'closed';
}

export interface MilestoneResult {
  number: number;
  title: string;
  url: string;
  dueOn: string | null;
}

interface RestMilestoneResponse {
  number: number;
  title: string;
  html_url: string;
  due_on: string | null;
}

export async function createMilestone(input: CreateMilestoneInput, deps: GithubClientDeps = {}): Promise<MilestoneResult> {
  const body: Record<string, unknown> = { title: input.title };
  if (input.description !== undefined) body.description = input.description;
  if (input.dueOn !== undefined) body.due_on = input.dueOn;
  if (input.state !== undefined) body.state = input.state;

  const data = (await githubRest(`/repos/${input.owner}/${input.repo}/milestones`, { method: 'POST', body }, deps)) as RestMilestoneResponse;
  return { number: data.number, title: data.title, url: data.html_url, dueOn: data.due_on };
}

export interface ListMilestonesInput {
  owner: string;
  repo: string;
  state?: 'open' | 'closed' | 'all';
}

export async function listMilestones(input: ListMilestonesInput, deps: GithubClientDeps = {}): Promise<MilestoneResult[]> {
  const state = input.state ?? 'open';
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/milestones?state=${state}`,
    {},
    deps,
  )) as RestMilestoneResponse[];
  return data.map((m) => ({ number: m.number, title: m.title, url: m.html_url, dueOn: m.due_on }));
}

export interface AssignMilestoneInput {
  owner: string;
  repo: string;
  issueNumber: number;
  /** null unassigns the milestone. */
  milestoneNumber: number | null;
}

export interface AssignMilestoneResult {
  issueNumber: number;
  milestoneNumber: number | null;
}

export async function assignMilestone(input: AssignMilestoneInput, deps: GithubClientDeps = {}): Promise<AssignMilestoneResult> {
  await githubRest(
    `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}`,
    { method: 'PATCH', body: { milestone: input.milestoneNumber } },
    deps,
  );
  return { issueNumber: input.issueNumber, milestoneNumber: input.milestoneNumber };
}
