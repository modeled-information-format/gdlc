import { githubRest, type GithubClientDeps } from '../github-client.js';
import { RepoConfigError } from '../errors.js';

export interface BranchRef {
  owner: string;
  repo: string;
  branch: string;
}

export interface BranchProtection {
  requiredStatusChecks: { strict: boolean; contexts: string[] } | null;
  enforceAdmins: boolean;
  requiredApprovingReviewCount: number | null;
}

interface RestBranchProtection {
  required_status_checks: { strict: boolean; contexts: string[] } | null;
  enforce_admins: { enabled: boolean };
  required_pull_request_reviews: { required_approving_review_count: number } | null;
}

export async function getBranchProtection(input: BranchRef, deps: GithubClientDeps = {}): Promise<BranchProtection> {
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`,
    {},
    deps,
  )) as RestBranchProtection;
  return {
    requiredStatusChecks: data.required_status_checks,
    enforceAdmins: data.enforce_admins.enabled,
    requiredApprovingReviewCount: data.required_pull_request_reviews?.required_approving_review_count ?? null,
  };
}

export interface UpdateBranchProtectionInput extends BranchRef {
  /** Required, not optional -- see the function doc comment: this tool's
   * own safety only holds if every field is genuinely required, forcing
   * the caller to state the full desired state on every call. */
  requiredStatusChecks: { strict: boolean; contexts: string[] } | null;
  enforceAdmins: boolean;
  requiredApprovingReviewCount: number | null;
}

/** GitHub's PUT branch-protection endpoint requires the full desired
 * state in one call (not a partial patch), so there's no "silently
 * cleared a field the caller didn't mention" risk the way a partial
 * PATCH would have -- PROVIDED this tool actually forces the caller to
 * state every field, which is why all three are required here (an
 * earlier version made them optional with disabling defaults, silently
 * reintroducing exactly the risk this comment claimed didn't exist --
 * caught in review). `restrictions: null` (no push restrictions) is
 * passed explicitly since the field is required by the API but this
 * plugin doesn't yet expose push restrictions as a tool input. */
export async function updateBranchProtection(input: UpdateBranchProtectionInput, deps: GithubClientDeps = {}): Promise<BranchProtection> {
  const body = {
    required_status_checks: input.requiredStatusChecks,
    enforce_admins: input.enforceAdmins,
    required_pull_request_reviews:
      input.requiredApprovingReviewCount != null ? { required_approving_review_count: input.requiredApprovingReviewCount } : null,
    restrictions: null,
  };
  const data = (await githubRest(
    `/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`,
    { method: 'PUT', body },
    deps,
  )) as RestBranchProtection;
  return {
    requiredStatusChecks: data.required_status_checks,
    enforceAdmins: data.enforce_admins.enabled,
    requiredApprovingReviewCount: data.required_pull_request_reviews?.required_approving_review_count ?? null,
  };
}

export interface DeleteBranchProtectionInput extends BranchRef {
  /** Must equal `branch` -- removing protection entirely opens the merge
   * gate on that branch, a different risk class than a single issue/PR
   * mutation. See README's "Confirm-echo contract". */
  confirmBranch: string;
}

export interface DeleteBranchProtectionResult {
  owner: string;
  repo: string;
  branch: string;
}

export async function deleteBranchProtection(
  input: DeleteBranchProtectionInput,
  deps: GithubClientDeps = {},
): Promise<DeleteBranchProtectionResult> {
  if (input.branch !== input.confirmBranch) {
    throw new RepoConfigError(
      'confirmation_mismatch',
      `branch (${input.branch}) and confirmBranch (${input.confirmBranch}) must match to confirm removing all protection.`,
      { branch: input.branch, confirmBranch: input.confirmBranch },
    );
  }
  await githubRest(`/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`, { method: 'DELETE' }, deps);
  return { owner: input.owner, repo: input.repo, branch: input.branch };
}
