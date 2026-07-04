import { githubRest, type GithubClientDeps } from '../github-client.js';

/** Read-only for v1: rulesets is the forward-compatible successor to
 * classic branch protection (multiple named rulesets per branch/tag
 * pattern, vs. one rule per branch), but write support (create/update)
 * needs its own confirm-echo design given the same broad-blast-radius
 * risk as branch protection -- deliberately deferred rather than rushed
 * alongside branch-protection's write tools. */

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface RulesetSummary {
  id: number;
  name: string;
  target: string;
  enforcement: string;
}

interface RestRuleset {
  id: number;
  name: string;
  target: string;
  enforcement: string;
}

export async function listRepoRulesets(input: RepoRef, deps: GithubClientDeps = {}): Promise<RulesetSummary[]> {
  const data = (await githubRest(`/repos/${input.owner}/${input.repo}/rulesets`, {}, deps)) as RestRuleset[];
  return data.map((r) => ({ id: r.id, name: r.name, target: r.target, enforcement: r.enforcement }));
}

export interface RulesetRef extends RepoRef {
  rulesetId: number;
}

export interface RulesetDetail extends RulesetSummary {
  bypassActors: Array<{ actorId: number | null; actorType: string; bypassMode: string }>;
}

interface RestRulesetDetail extends RestRuleset {
  bypass_actors?: Array<{ actor_id: number | null; actor_type: string; bypass_mode: string }>;
}

export async function getRepoRuleset(input: RulesetRef, deps: GithubClientDeps = {}): Promise<RulesetDetail> {
  const data = (await githubRest(`/repos/${input.owner}/${input.repo}/rulesets/${input.rulesetId}`, {}, deps)) as RestRulesetDetail;
  return {
    id: data.id,
    name: data.name,
    target: data.target,
    enforcement: data.enforcement,
    bypassActors: (data.bypass_actors ?? []).map((a) => ({ actorId: a.actor_id, actorType: a.actor_type, bypassMode: a.bypass_mode })),
  };
}
