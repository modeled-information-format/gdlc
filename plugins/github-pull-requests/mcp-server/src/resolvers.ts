import { githubRest, type GithubClientDeps } from './github-client.js';
import { PrError } from './errors.js';

interface NodeIdResponse {
  node_id?: string;
}

/** Trivial, single-call-site lookups — deliberately not shared with the
 * sibling github-sdlc-planning package's equivalents (resolveRepositoryId is
 * duplicated here rather than imported, to keep every failure a native
 * PrError instead of translating a cross-package PlanningError). */
export async function resolveRepositoryId(owner: string, repo: string, deps: GithubClientDeps = {}): Promise<string> {
  try {
    const data = (await githubRest(`/repos/${owner}/${repo}`, {}, deps)) as NodeIdResponse;
    if (!data.node_id) throw new Error('response missing node_id');
    return data.node_id;
  } catch (cause) {
    throw new PrError('resolve_id_failed', `Failed to resolve repository node ID for ${owner}/${repo}`, {
      lookupStep: 'resolve_repository_id',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export async function resolvePullRequestNodeId(
  owner: string,
  repo: string,
  pullNumber: number,
  deps: GithubClientDeps = {},
): Promise<string> {
  try {
    const data = (await githubRest(`/repos/${owner}/${repo}/pulls/${pullNumber}`, {}, deps)) as NodeIdResponse;
    if (!data.node_id) throw new Error('response missing node_id');
    return data.node_id;
  } catch (cause) {
    throw new PrError('resolve_id_failed', `Failed to resolve pull request node ID for ${owner}/${repo}#${pullNumber}`, {
      lookupStep: 'resolve_pull_request_id',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
