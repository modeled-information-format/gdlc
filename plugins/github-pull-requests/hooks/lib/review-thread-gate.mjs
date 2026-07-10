/**
 * gdlc#202/#211: the testable core behind review-thread-gate.mjs
 * (PreToolUse). CLAUDE.local.md's own rule: "Before creating any new
 * worktree/branch/PR in a session that has already opened one or more
 * PRs, re-check reviewThreads{isResolved} fresh on every one of them. If
 * any thread on any of them is unresolved, that is the only work that
 * happens next." This module detects the worktree/branch-creation moment
 * and answers "does any PR opened this session still have unresolved
 * threads" -- track-opened-prs.mjs (a separate PostToolUse hook) is what
 * populates the session-scoped list this reads.
 *
 * Every GraphQL round trip goes through a caller-supplied `runGraphQL`,
 * same dependency-injection shape as every other hook lib in this
 * marketplace -- this module never shells out itself.
 */

/** Matches the Bash commands that create a new local branch or worktree --
 * `git worktree add [...] -b <branch>`, `git checkout -b <branch>`,
 * `git switch -c <branch>`, and a plain `git branch <name>` (creating).
 * Code-review finding: an earlier revision only excluded `git branch
 * -d`/`-D`/`--list`, which still misclassified every OTHER read-only
 * invocation as a creation -- `-a`, `-r`, `-v`/`-vv`, `--show-current`
 * (the exact command this workspace's own CLAUDE.local.md instructs
 * running before every phase), `-m`/`-M`/`--move`, `--set-upstream-to`,
 * etc. `git branch` only ever creates when its first argument is a bare
 * name with no leading `-` at all -- every flag form is excluded by the
 * general `(?!-)` lookahead below instead of enumerating each one, so a
 * future git-branch flag never needs a matching update here. Deliberately
 * does NOT match `git worktree add <path> <existing-ref>` (checking out
 * an existing branch into a new worktree creates no new branch, and this
 * gate's whole concern is starting NEW work) -- see `EnterWorktree`'s own
 * convention of always pairing worktree creation with a new branch, which
 * is exactly the shape this regex requires. */
export const BRANCH_OR_WORKTREE_CREATE_RE =
  /^\s*git\s+(?:worktree\s+add\b.*\s-b\s+\S+|checkout\s+-b\s+\S+|switch\s+-c\s+\S+|branch\s+(?!-)\S+)/;

/** `EnterWorktree` is a distinct Claude Code tool (not a Bash invocation)
 * that always creates a worktree, and per its own convention, a branch
 * alongside it -- recognized by name, not by inspecting a command string
 * the way the Bash surface is. */
export function isWorktreeOrBranchCreation(toolName, toolInput) {
  if (toolName === 'EnterWorktree') return true;
  if (toolName !== 'Bash') return false;
  const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
  return BRANCH_OR_WORKTREE_CREATE_RE.test(command);
}

export const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) { nodes { isResolved } }
      }
    }
  }
`;

/** For each tracked PR, queries its current review-thread resolution and
 * returns only the ones with at least one unresolved thread (plus the
 * count). Fails open PER REF -- a GraphQL error for one PR (deleted repo,
 * revoked access, transient failure) never suppresses a real finding for
 * another; matches every other check in this hook family's "never guess,
 * never let one failure hide another's finding" contract.
 *
 * Code-review finding: queries every tracked PR CONCURRENTLY
 * (Promise.allSettled), not one at a time -- a session that opened N PRs
 * previously paid N sequential round trips on this PreToolUse gate before
 * any worktree/branch-creation command was allowed to proceed. The
 * production runGraphQL (review-thread-gate.mjs's entrypoint) is itself
 * async (execFile, not execFileSync) specifically so these can genuinely
 * overlap rather than one blocking subprocess call serializing them. */
export async function checkUnresolvedReviewThreads(prs, runGraphQL) {
  const results = await Promise.allSettled(
    prs.map(async (ref) => {
      const data = await runGraphQL(REVIEW_THREADS_QUERY, { owner: ref.owner, repo: ref.repo, number: ref.pullNumber });
      const nodes = data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
      const unresolved = nodes.filter((n) => !n.isResolved).length;
      return unresolved > 0 ? { ...ref, unresolved } : null;
    }),
  );
  return results.filter((r) => r.status === 'fulfilled' && r.value !== null).map((r) => r.value);
}

export function buildGateReason(flagged) {
  const parts = flagged.map((f) => `${f.owner}/${f.repo}#${f.pullNumber} (${f.unresolved} unresolved)`);
  return (
    `This session opened ${flagged.length === 1 ? 'a PR that' : 'PRs that'} still ${flagged.length === 1 ? 'has' : 'have'} unresolved review ` +
    `threads: ${parts.join(', ')}. Per this workspace's rule, resolve every thread on every already-open PR before starting new ` +
    `branch/worktree work.`
  );
}
