import { type GithubClientDeps } from '../github-client.js';
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
export declare function createMilestone(input: CreateMilestoneInput, deps?: GithubClientDeps): Promise<MilestoneResult>;
export interface ListMilestonesInput {
    owner: string;
    repo: string;
    state?: 'open' | 'closed' | 'all';
}
export declare function listMilestones(input: ListMilestonesInput, deps?: GithubClientDeps): Promise<MilestoneResult[]>;
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
export declare function assignMilestone(input: AssignMilestoneInput, deps?: GithubClientDeps): Promise<AssignMilestoneResult>;
